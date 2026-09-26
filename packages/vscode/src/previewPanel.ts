import * as vscode from 'vscode';
import * as path from 'path';
import { outputChannel, diagnosticCollection } from './extension';

interface ParsedNode {
    id: string;
    level: number;
    kind: string;
    params?: Record<string, string>;
    content: string;
    contentLineNos?: number[];
    children: ParsedNode[];
    sourceRange: { startLine: number; endLine: number };
}

export class PreviewPanel {
    public static readonly viewType = 'asciiwirePreview';
    public static currentPanel: PreviewPanel | undefined;
    /** Set when the user closes the panel; suppresses auto-open until they reopen it explicitly. */
    public static userClosed = false;

    private _ascii: string = '';
    private _lastNodes: ParsedNode[] = [];
    private _lastBoxes: { nodeId: string; kind: string; rect: { x: number; y: number; w: number; h: number } }[] = [];
    private _document: vscode.TextDocument | undefined;
    private _needsRefresh = false;

    public static get currentAscii(): string {
        return PreviewPanel.currentPanel ? PreviewPanel.currentPanel._ascii : '';
    }
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (PreviewPanel.currentPanel) {
            PreviewPanel.currentPanel._panel.reveal(column);
            return;
        }

        PreviewPanel.userClosed = false;
        const panel = vscode.window.createWebviewPanel(
            PreviewPanel.viewType,
            'ASCIIwire Preview',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'webview'),
                    vscode.Uri.joinPath(extensionUri, '..', 'core', 'dist')
                ]
            }
        );

        PreviewPanel.currentPanel = new PreviewPanel(panel, extensionUri);
    }

    public static update(document: vscode.TextDocument) {
        if (PreviewPanel.currentPanel) {
            PreviewPanel.currentPanel._document = document;
            PreviewPanel.currentPanel._update(document);
        }
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._document = vscode.window.activeTextEditor?.document;
        this._update(this._document);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Push pending updates when the panel becomes visible again
        this._panel.onDidChangeViewState(() => {
            if (this._panel.visible && this._needsRefresh) {
                this._needsRefresh = false;
                this._postUpdate();
            }
        }, null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'selectNode':
                        this._onSelectNode(message.nodeId);
                        return;
                    case 'moveNode':
                        this._onMoveNode(message.nodeId, message.dx, message.dy);
                        return;
                    case 'resizeNode':
                        this._onResizeNode(message.nodeId, message.dw, message.dh);
                        return;
                    case 'deleteNode':
                        this._onDeleteNode(message.nodeId);
                        return;
                    case 'addNode':
                        this._onAddNode(message.kind, message.targetNodeId, message.position);
                        return;
                    case 'requestEditContent':
                        this._onRequestEditContent(message.nodeId);
                        return;
                    case 'editNodeContent':
                        this._onEditNodeContent(message.nodeId, message.newContent);
                        return;
                    case 'editNodeProperty':
                        this._onEditNodeProperty(message.nodeId, message.property, message.value);
                        return;
                    case 'selectParent':
                        this._onSelectParent(message.nodeId);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    // ------------------------------------------------------------------
    // DSL write-back helpers
    // ------------------------------------------------------------------

    private _findNodeById(nodes: ParsedNode[], nodeId: string): ParsedNode | null {
        for (const node of nodes) {
            if (node.id === nodeId) return node;
            const found = this._findNodeById(node.children, nodeId);
            if (found) return found;
        }
        return null;
    }

    private _findParentOfNode(nodes: ParsedNode[], nodeId: string, parent: ParsedNode | null = null): ParsedNode | null {
        for (const node of nodes) {
            if (node.id === nodeId) return parent;
            const found = this._findParentOfNode(node.children, nodeId, node);
            if (found) return found;
        }
        return null;
    }

    private _getEditor(): vscode.TextEditor | undefined {
        if (this._document) {
            const editor = vscode.window.visibleTextEditors.find(e =>
                e.document.uri.toString() === this._document!.uri.toString()
            );
            if (editor) return editor;
        }
        return vscode.window.visibleTextEditors.find(e =>
            e.document.fileName.endsWith('.wire')
        ) || vscode.window.activeTextEditor;
    }

    private _nodeRange(node: ParsedNode): vscode.Range {
        return new vscode.Range(
            new vscode.Position(node.sourceRange.startLine, 0),
            new vscode.Position(node.sourceRange.endLine + 1, 0)
        );
    }

    /**
     * Write a width/height parameter, preserving the unit:
     * N% stays % (recomputed against the parent), fill/auto/unset become absolute N.
     */
    private _writeSizeParam(
        editBuilder: vscode.TextEditorEdit,
        editor: vscode.TextEditor,
        node: ParsedNode,
        axis: 'width' | 'height',
        newSize: number,
        parentTotal: number
    ) {
        const line = editor.document.lineAt(node.sourceRange.startLine);
        const raw = node.params?.[axis];
        let value: string;
        if (raw && /^\d+%$/.test(raw)) {
            const pct = parentTotal > 0 ? Math.round((newSize / parentTotal) * 100) : 0;
            value = `${Math.max(1, Math.min(100, pct))}%`;
        } else {
            value = String(Math.max(1, Math.round(newSize)));
        }
        const re = new RegExp(`${axis}=(?:"[^"]*"|\\S+)`);
        const newText = re.test(line.text)
            ? line.text.replace(re, `${axis}=${value}`)
            : `${line.text} ${axis}=${value}`;
        editBuilder.replace(line.range, newText);
    }

    private _neighbor(siblings: ParsedNode[], node: ParsedNode): ParsedNode | undefined {
        const i = siblings.indexOf(node);
        return siblings[i + 1] ?? siblings[i - 1];
    }

    /** If the adjacent sibling has a fixed size on this axis, offset it by -delta. fill/auto absorb automatically. */
    private _offsetFixedNeighbor(
        editBuilder: vscode.TextEditorEdit,
        editor: vscode.TextEditor,
        siblings: ParsedNode[],
        node: ParsedNode,
        axis: 'width' | 'height',
        delta: number
    ) {
        const neighbor = this._neighbor(siblings, node);
        if (!neighbor) return;
        const raw = neighbor.params?.[axis];
        if (!raw || !/^\d+$/.test(raw)) return;
        const nBox = this._lastBoxes.find(b => b.nodeId === neighbor.id);
        if (!nBox) return;
        const newSize = Math.max(1, (axis === 'width' ? nBox.rect.w : nBox.rect.h) - delta);
        const line = editor.document.lineAt(neighbor.sourceRange.startLine);
        const re = new RegExp(`${axis}=\\d+`);
        editBuilder.replace(line.range, line.text.replace(re, `${axis}=${newSize}`));
    }

    // ------------------------------------------------------------------
    // Webview commands
    // ------------------------------------------------------------------

    private _onResizeNode(nodeId: string, dw: number, dh: number) {
        outputChannel.appendLine(`Resizing node: ${nodeId} by ${dw},${dh}`);
        try {
            const node = this._findNodeById(this._lastNodes, nodeId);
            const parent = this._findParentOfNode(this._lastNodes, nodeId);
            if (!node || !node.sourceRange) {
                vscode.window.showErrorMessage(`Resize failed: node not found`);
                return;
            }
            const editor = this._getEditor();
            if (!editor) {
                vscode.window.showErrorMessage(`Resize failed: no editor found`);
                return;
            }

            const box = this._lastBoxes.find(b => b.nodeId === nodeId);
            const parentBox = parent && this._lastBoxes.find(b => b.nodeId === parent.id);
            const siblings = parent?.children ?? [];

            editor.edit(editBuilder => {
                if (dw !== 0 && box) {
                    const parentTotal = parentBox ? parentBox.rect.w + Math.max(0, siblings.length - 1) : 0;
                    this._writeSizeParam(editBuilder, editor, node, 'width', box.rect.w + dw, parentTotal);
                    if (parent?.kind === 'hstack') {
                        this._offsetFixedNeighbor(editBuilder, editor, siblings, node, 'width', dw);
                    }
                }
                if (dh !== 0 && box) {
                    const parentTotal = parentBox ? parentBox.rect.h + Math.max(0, siblings.length - 1) : 0;
                    this._writeSizeParam(editBuilder, editor, node, 'height', box.rect.h + dh, parentTotal);
                    if (parent && parent.kind !== 'hstack') {
                        this._offsetFixedNeighbor(editBuilder, editor, siblings, node, 'height', dh);
                    }
                }
            }).then(() => {
                this._update(editor.document);
            }, (err: any) => {
                outputChannel.appendLine(`Resize edit error: ${err}`);
            });
        } catch (err) {
            outputChannel.appendLine(`Resize error: ${err}`);
        }
    }

    private _onMoveNode(nodeId: string, dx: number, dy: number) {
        outputChannel.appendLine(`Moving node: ${nodeId} by ${dx},${dy}`);
        const node = this._findNodeById(this._lastNodes, nodeId);
        const parent = this._findParentOfNode(this._lastNodes, nodeId);
        if (!node || !parent) return;

        const editor = this._getEditor();
        if (!editor) return;

        // Reorder within the same parent, swapping the whole subtree range.
        // Direction follows the parent layout: hstack → horizontal, otherwise → vertical.
        const siblings = parent.children;
        const index = siblings.indexOf(node);
        if (index === -1) return;

        const horizontal = parent.kind === 'hstack';
        let target: ParsedNode | undefined;
        if (horizontal && dx !== 0) target = siblings[index + (dx > 0 ? 1 : -1)];
        if (!horizontal && dy !== 0) target = siblings[index + (dy > 0 ? 1 : -1)];
        if (!target) return;

        try {
            editor.edit(editBuilder => {
                const rangeA = this._nodeRange(node);
                const rangeB = this._nodeRange(target!);
                const textA = editor.document.getText(rangeA);
                const textB = editor.document.getText(rangeB);
                // Ranges are non-overlapping; swapping text between them reorders the blocks
                editBuilder.replace(rangeB, textA);
                editBuilder.replace(rangeA, textB);
            }).then(() => {
                this._update(editor.document);
            }, (err: any) => {
                outputChannel.appendLine(`Move edit error: ${err}`);
            });
        } catch (err) {
            outputChannel.appendLine(`Move error: ${err}`);
        }
    }

    private _onDeleteNode(nodeId: string) {
        outputChannel.appendLine(`Deleting node: ${nodeId}`);
        const node = this._findNodeById(this._lastNodes, nodeId);
        if (!node || !node.sourceRange) {
            vscode.window.showErrorMessage(`Delete failed: node not found`);
            return;
        }
        const editor = this._getEditor();
        if (!editor) return;

        editor.edit(editBuilder => {
            editBuilder.delete(this._nodeRange(node));
        }).then(() => {
            this._update(editor.document);
        });
    }

    private _onAddNode(kind: string, targetNodeId: string, position: 'before' | 'after' | 'child') {
        outputChannel.appendLine(`Adding node: @${kind} near ${targetNodeId} (${position})`);
        const editor = this._getEditor();
        if (!editor) return;

        const targetNode = this._findNodeById(this._lastNodes, targetNodeId);
        if (!targetNode || !targetNode.sourceRange) {
            vscode.window.showErrorMessage(`Add failed: target node not found`);
            return;
        }

        let insertLine: number;
        let indentLevel: number;

        if (position === 'child') {
            // Append as the last child: after the target's whole subtree
            insertLine = targetNode.sourceRange.endLine + 1;
            indentLevel = (targetNode.level || 0) + 1;
        } else if (position === 'after') {
            insertLine = targetNode.sourceRange.endLine + 1;
            indentLevel = targetNode.level || 0;
        } else {
            insertLine = targetNode.sourceRange.startLine;
            indentLevel = targetNode.level || 0;
        }

        const indent = '  '.repeat(indentLevel);
        const isLayout = kind === 'hstack' || kind === 'vstack';
        const newLines = isLayout
            ? `${indent}@${kind}`
            : `${indent}@${kind}\n${'  '.repeat(indentLevel + 1)}New ${kind}`;

        editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(insertLine, 0), newLines + '\n');
        }).then(() => {
            this._update(editor.document);
        });
    }

    private _onRequestEditContent(nodeId: string) {
        const node = this._findNodeById(this._lastNodes, nodeId);
        if (!node) return;
        this._panel.webview.postMessage({ command: 'showEditor', nodeId: node.id, content: node.content });
    }

    private _onEditNodeContent(nodeId: string, newContent: string) {
        outputChannel.appendLine(`Editing content for node: ${nodeId}`);
        const node = this._findNodeById(this._lastNodes, nodeId);
        if (!node || !node.sourceRange) {
            vscode.window.showErrorMessage(`Edit failed: node not found`);
            return;
        }
        const editor = this._getEditor();
        if (!editor) return;

        const indent = '  '.repeat((node.level || 0) + 1);
        const owned = node.contentLineNos ?? [];
        const newLines = newContent === '' ? [] : newContent.split('\n');

        editor.edit(editBuilder => {
            // Replace owned content lines in place, preserving comments and blank lines
            const n = Math.min(owned.length, newLines.length);
            for (let i = 0; i < n; i++) {
                const line = editor.document.lineAt(owned[i]);
                editBuilder.replace(line.range, indent + newLines[i]);
            }
            if (newLines.length > owned.length) {
                const at = owned.length ? owned[owned.length - 1] + 1 : node.sourceRange.startLine + 1;
                const extra = newLines.slice(owned.length).map(l => indent + l).join('\n') + '\n';
                editBuilder.insert(new vscode.Position(at, 0), extra);
            } else if (owned.length > newLines.length) {
                for (let i = n; i < owned.length; i++) {
                    editBuilder.delete(editor.document.lineAt(owned[i]).rangeIncludingLineBreak);
                }
            }
        }).then(() => {
            this._update(editor.document);
        });
    }

    private _onEditNodeProperty(nodeId: string, property: string, value: string) {
        outputChannel.appendLine(`Editing property ${property}=${value} for node: ${nodeId}`);
        const node = this._findNodeById(this._lastNodes, nodeId);
        if (!node || !node.sourceRange) {
            vscode.window.showErrorMessage(`Edit failed: node not found`);
            return;
        }
        const editor = this._getEditor();
        if (!editor) return;

        const line = editor.document.lineAt(node.sourceRange.startLine);
        const lineText = line.text;

        let newText: string;
        if (property === 'kind') {
            newText = lineText.replace(/^(\s*)@\S+/, `$1@${value}`);
        } else {
            const re = new RegExp(`${property}=(?:"[^"]*"|\\S+)`);
            newText = re.test(lineText)
                ? lineText.replace(re, `${property}=${value}`)
                : `${lineText} ${property}=${value}`;
        }

        editor.edit(editBuilder => {
            editBuilder.replace(line.range, newText);
        }).then(() => {
            this._update(editor.document);
        });
    }

    private _onSelectParent(nodeId: string) {
        const parent = this._findParentOfNode(this._lastNodes, nodeId);
        if (parent && parent.id) {
            this._panel.webview.postMessage({ command: 'parentSelected', nodeId: parent.id, kind: parent.kind });
        }
    }

    private _onSelectNode(nodeId: string) {
        outputChannel.appendLine(`Selecting node: ${nodeId}`);
        const node = this._findNodeById(this._lastNodes, nodeId);
        if (node?.sourceRange) {
            const editor = this._getEditor();
            if (editor) {
                const start = new vscode.Position(node.sourceRange.startLine, 0);
                const end = new vscode.Position(node.sourceRange.endLine + 1, 0);
                const range = new vscode.Range(start, end);
                vscode.window.showTextDocument(editor.document, editor.viewColumn, false).then(ed => {
                    ed.selection = new vscode.Selection(start, end);
                    ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                });
            }
        }
    }

    // ------------------------------------------------------------------
    // Rendering / update plumbing
    // ------------------------------------------------------------------

    public dispose() {
        PreviewPanel.currentPanel = undefined;
        PreviewPanel.userClosed = true;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _isFirstUpdate: boolean = true;

    private _update(document?: vscode.TextDocument) {
        const text = document ? document.getText() : '';
        try {
            const result = this._render(text);
            this._ascii = result.ascii;
            this._lastNodes = result.nodes;
            this._lastBoxes = result.boxes;

            this._publishDiagnostics(document, result.diagnostics);

            if (this._isFirstUpdate) {
                this._panel.webview.html = this._getHtmlForWebview(this._ascii, result.grid, result.boxes);
                this._isFirstUpdate = false;
            } else if (this._panel.visible) {
                this._postUpdate();
            } else {
                this._needsRefresh = true;
            }
        } catch (e) {
            this._panel.webview.html = `Error: ${e}`;
        }
    }

    private _postUpdate() {
        const result = this._render(this._document ? this._document.getText() : '');
        this._panel.webview.postMessage({
            command: 'update',
            content: this._ascii,
            grid: result.grid,
            boxes: result.boxes,
        });
    }

    private _publishDiagnostics(document: vscode.TextDocument | undefined, diagnostics: { severity: string; message: string; line?: number; nodeId?: string }[]) {
        if (!document || document.uri.scheme !== 'file') return;
        const items: vscode.Diagnostic[] = [];
        for (const d of diagnostics) {
            let line = d.line;
            if (line === undefined && d.nodeId) {
                const node = this._findNodeById(this._lastNodes, d.nodeId);
                line = node?.sourceRange.startLine;
            }
            if (line === undefined || line >= document.lineCount) continue;
            const docLine = document.lineAt(line);
            items.push(new vscode.Diagnostic(
                docLine.range,
                d.message,
                d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
            ));
        }
        diagnosticCollection.set(document.uri, items);
    }

    private _render(text: string): {
        ascii: string;
        grid: (string | null)[][];
        boxes: { nodeId: string; kind: string; rect: { x: number; y: number; w: number; h: number } }[];
        nodes: ParsedNode[];
        diagnostics: { severity: string; message: string; line?: number; nodeId?: string }[];
    } {
        try {
            let core;
            try {
                core = require('@asciiwire/core');
            } catch (e) {
                const corePath = path.join(this._extensionUri.fsPath, '..', 'core', 'dist', 'index.js');
                core = require(corePath);
            }

            if (!core || typeof core.parseDSL !== 'function') {
                throw new Error('Could not find ASCIIwire core components');
            }

            const parsed = core.parseDSL(text);
            const rendered = core.renderASCII(parsed.nodes, { width: 80 });
            return {
                ascii: rendered.ascii,
                grid: rendered.grid,
                boxes: rendered.boxes ?? [],
                nodes: parsed.nodes,
                diagnostics: [...(parsed.diagnostics ?? []), ...(rendered.diagnostics ?? [])],
            };
        } catch (err) {
            outputChannel.appendLine(`Render error: ${err}`);
            return {
                ascii: `Error rendering ASCII: ${err}`,
                grid: [],
                boxes: [],
                nodes: this._lastNodes,
                diagnostics: [{ severity: 'error', message: String(err) }],
            };
        }
    }

    private _getHtmlForWebview(content: string, grid: any[] = [], boxes: any[] = []) {
        const stylesUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview', 'styles.css'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASCIIwire Preview</title>
    <link rel="stylesheet" href="${stylesUri}">
    <style>
        body {
            padding: 0;
            margin: 0;
            overflow: hidden;
        }
        #toolbar {
            display: flex;
            gap: 4px;
            padding: 4px 8px;
            background: var(--vscode-editorWidget-background, #2d2d2d);
            border-bottom: 1px solid var(--vscode-editorWidget-border, #3c3c3c);
            font-size: 12px;
            font-family: var(--vscode-editor-font-family);
            z-index: 200;
        }
        #toolbar button {
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #fff);
            border: none;
            padding: 2px 8px;
            cursor: pointer;
            font-size: 11px;
            border-radius: 2px;
        }
        #toolbar button:hover {
            background: var(--vscode-button-secondaryHoverBackground, #45494e);
        }
        #toolbar .spacer { flex: 1; }
        #toolbar .selected-info {
            color: var(--vscode-descriptionForeground, #888);
            padding: 2px 8px;
            font-size: 11px;
        }
        #ascii-output {
            position: relative;
            cursor: crosshair;
            user-select: none;
            padding: 0;
            margin: 0;
            white-space: pre;
            display: inline-block;
        }
        .highlight-overlay {
            position: absolute;
            background: rgba(0, 122, 204, 0.1);
            border: 1px solid rgba(0, 122, 204, 0.5);
            pointer-events: none;
            z-index: 100;
            transition: none;
        }
        .selected-overlay {
            position: absolute;
            background: rgba(0, 122, 204, 0.25);
            border: 2px solid #007acc;
            pointer-events: none;
            z-index: 90;
            transition: none;
        }
        .selected-overlay .resize-handle {
            pointer-events: auto;
        }
        .resize-handle {
            position: absolute;
            right: -7px;
            bottom: -7px;
            width: 14px;
            height: 14px;
            background: #007acc;
            border: 1px solid #fff;
            cursor: nwse-resize;
            pointer-events: auto;
        }
        #context-menu {
            position: fixed;
            background: var(--vscode-menu-background, #2d2d2d);
            border: 1px solid var(--vscode-menu-border, #555);
            box-shadow: 2px 2px 8px rgba(0,0,0,0.3);
            z-index: 300;
            font-size: 12px;
            font-family: var(--vscode-editor-font-family);
            min-width: 160px;
            display: none;
        }
        #context-menu .menu-item {
            padding: 4px 12px;
            cursor: pointer;
            color: var(--vscode-menu-foreground, #ccc);
        }
        #context-menu .menu-item:hover {
            background: var(--vscode-menu-selectionBackground, #094771);
        }
        #context-menu .menu-separator {
            border-top: 1px solid var(--vscode-menu-separatorBackground, #555);
            margin: 2px 0;
        }
        #context-menu .menu-label {
            padding: 4px 12px;
            color: var(--vscode-descriptionForeground, #888);
            font-size: 11px;
        }
        #edit-overlay {
            position: absolute;
            z-index: 250;
            background: var(--vscode-editor-background, #1e1e1e);
            border: 2px solid #007acc;
            display: none;
        }
        #edit-overlay textarea {
            width: 100%;
            height: 100%;
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-editor-foreground, #d4d4d4);
            border: none;
            outline: none;
            resize: none;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            padding: 2px;
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <button onclick="addElement('panel')">+ Panel</button>
        <button onclick="addElement('header')">+ Header</button>
        <button onclick="addElement('nav')">+ Nav</button>
        <button onclick="addElement('table')">+ Table</button>
        <button onclick="addElement('list')">+ List</button>
        <button onclick="addElement('footer')">+ Footer</button>
        <button onclick="addElement('vstack')">+ VStack</button>
        <button onclick="addElement('hstack')">+ HStack</button>
        <span class="spacer"></span>
        <span class="selected-info" id="selected-info">No selection</span>
        <button onclick="deleteSelected()" style="color: #f44">Delete</button>
    </div>
    <div id="app" style="overflow: auto; width: 100vw; height: calc(100vh - 30px); position: relative;">
        <div id="content-wrapper" style="position: relative; display: inline-block;">
            <pre id="ascii-output">${this._escapeHtml(content)}</pre>
            <div id="overlay-container" style="position: absolute; top: 0; left: 0; pointer-events: none;"></div>
        </div>
    </div>
    <div id="context-menu"></div>
    <div id="edit-overlay"><textarea></textarea></div>
    <script>
        const vscode = acquireVsCodeApi();
        let currentGrid = ${JSON.stringify(grid)};
        let currentBoxes = ${JSON.stringify(boxes)};
        const output = document.getElementById('ascii-output');
        const overlayContainer = document.getElementById('overlay-container');
        const contextMenu = document.getElementById('context-menu');
        const editOverlay = document.getElementById('edit-overlay');
        const editTextarea = editOverlay.querySelector('textarea');
        const selectedInfo = document.getElementById('selected-info');
        let selectedNodeId = null;

        function getMetrics() {
            const measure = document.createElement('span');
            measure.innerText = 'A';
            measure.style.fontFamily = getComputedStyle(output).fontFamily;
            measure.style.fontSize = getComputedStyle(output).fontSize;
            measure.style.position = 'absolute';
            measure.style.visibility = 'hidden';
            measure.style.top = '0';
            measure.style.left = '0';
            document.body.appendChild(measure);
            const rect = measure.getBoundingClientRect();
            const metrics = { width: rect.width, height: rect.height };
            document.body.removeChild(measure);
            return metrics;
        }

        let metrics = getMetrics();
        window.addEventListener('resize', () => { metrics = getMetrics(); });

        let isResizing = false;
        let isDragging = false;
        let dragStart = { x: 0, y: 0, r: 0, c: 0 };
        let draggedNodeId = null;
        let didDrag = false;

        function findNodeBounds(nodeId) {
            const box = currentBoxes.find(b => b.nodeId === nodeId);
            if (!box) return null;
            return { minR: box.rect.y, maxR: box.rect.y + box.rect.h - 1, minC: box.rect.x, maxC: box.rect.x + box.rect.w - 1 };
        }

        function createOverlay(nodeId, bounds, className, dx, dy, dw, dh) {
            const offsetX = output.offsetLeft;
            const offsetY = output.offsetTop;
            const overlay = document.createElement('div');
            overlay.className = className;
            overlay.style.top = (offsetY + (bounds.minR + dy) * metrics.height) + 'px';
            overlay.style.left = (offsetX + (bounds.minC + dx) * metrics.width) + 'px';
            overlay.style.width = ((bounds.maxC - bounds.minC + 1 + dw) * metrics.width) + 'px';
            overlay.style.height = ((bounds.maxR - bounds.minR + 1 + dh) * metrics.height) + 'px';
            return overlay;
        }

        function createResizeHandle(nodeId) {
            const handle = document.createElement('div');
            handle.className = 'resize-handle';
            handle.onmousedown = (e) => {
                isResizing = true;
                draggedNodeId = nodeId;
                dragStart = { x: e.clientX, y: e.clientY };
                e.stopPropagation();
                e.preventDefault();
            };
            return handle;
        }

        function updateHighlight(nodeId, dx = 0, dy = 0, dw = 0, dh = 0) {
            // Clear only hover overlays, keep selected overlay
            overlayContainer.querySelectorAll('.highlight-overlay').forEach(el => el.remove());
            if (!nodeId) return;

            const bounds = findNodeBounds(nodeId);
            if (!bounds) return;

            const overlay = createOverlay(nodeId, bounds, 'highlight-overlay', dx, dy, dw, dh);
            if (isDragging || isResizing) {
                overlay.style.background = isResizing ? 'rgba(255, 165, 0, 0.4)' : 'rgba(0, 122, 204, 0.4)';
                overlay.style.border = isResizing ? '2px solid orange' : '2px solid #007acc';
            }
            overlayContainer.appendChild(overlay);
        }

        function updateSelectedHighlight(nodeId) {
            overlayContainer.querySelectorAll('.selected-overlay').forEach(el => el.remove());
            if (!nodeId) return;

            const bounds = findNodeBounds(nodeId);
            if (!bounds) return;

            const overlay = createOverlay(nodeId, bounds, 'selected-overlay', 0, 0, 0, 0);
            const handle = createResizeHandle(nodeId);
            overlay.appendChild(handle);
            overlayContainer.appendChild(overlay);
        }

        function selectNode(nodeId) {
            selectedNodeId = nodeId;
            updateSelectedHighlight(nodeId);
            if (nodeId) {
                vscode.postMessage({ command: 'selectNode', nodeId });
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'update') {
                output.textContent = message.content;
                currentGrid = message.grid || [];
                currentBoxes = message.boxes || [];
                metrics = getMetrics();
                updateSelectedHighlight(selectedNodeId);
            } else if (message.command === 'parentSelected') {
                selectedNodeId = message.nodeId;
                updateSelectedHighlight(message.nodeId);
                selectedInfo.textContent = 'Selected: ' + (message.kind || 'node');
            } else if (message.command === 'showEditor') {
                selectedNodeId = message.nodeId;
                showContentEditor(message.nodeId, message.content);
            }
        });

        output.addEventListener('mousedown', e => {
            if (e.button === 2) return; // Right click handled separately
            const rect = output.getBoundingClientRect();
            const c = Math.floor((e.clientX - rect.left) / metrics.width);
            const r = Math.floor((e.clientY - rect.top) / metrics.height);

            if (currentGrid[r] && currentGrid[r][c]) {
                isDragging = true;
                draggedNodeId = currentGrid[r][c];
                dragStart = { x: e.clientX, y: e.clientY, r, c };
                e.preventDefault();
            }
        });

        window.addEventListener('mousemove', e => {
            if (isResizing) {
                const dw = Math.round((e.clientX - dragStart.x) / metrics.width);
                const dh = Math.round((e.clientY - dragStart.y) / metrics.height);
                updateHighlight(draggedNodeId, 0, 0, dw, dh);
            } else if (isDragging) {
                const dx = Math.round((e.clientX - dragStart.x) / metrics.width);
                const dy = Math.round((e.clientY - dragStart.y) / metrics.height);
                updateHighlight(draggedNodeId, dx, dy);
            } else {
                const rect = output.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const col = Math.floor(x / metrics.width);
                const row = Math.floor(y / metrics.height);

                if (currentGrid[row] && currentGrid[row][col]) {
                    updateHighlight(currentGrid[row][col]);
                } else {
                    updateHighlight(null);
                }
            }
        });

        window.addEventListener('mouseup', e => {
            if (isResizing) {
                const dw = Math.round((e.clientX - dragStart.x) / metrics.width);
                const dh = Math.round((e.clientY - dragStart.y) / metrics.height);
                if (dw !== 0 || dh !== 0) {
                    didDrag = true;
                    vscode.postMessage({ command: 'resizeNode', nodeId: draggedNodeId, dw, dh });
                }
                isResizing = false;
                draggedNodeId = null;
                updateHighlight(null);
                updateSelectedHighlight(selectedNodeId);
            } else if (isDragging) {
                const dx = Math.round((e.clientX - dragStart.x) / metrics.width);
                const dy = Math.round((e.clientY - dragStart.y) / metrics.height);

                if (dx !== 0 || dy !== 0) {
                    didDrag = true;
                    vscode.postMessage({
                        command: 'moveNode',
                        nodeId: draggedNodeId,
                        dx, dy
                    });
                }

                isDragging = false;
                draggedNodeId = null;
                updateHighlight(null);
                updateSelectedHighlight(selectedNodeId);
            }
        });

        output.addEventListener('click', e => {
            if (didDrag) {
                didDrag = false;
                return;
            }
            const rect = output.getBoundingClientRect();
            const col = Math.floor((e.clientX - rect.left) / metrics.width);
            const row = Math.floor((e.clientY - rect.top) / metrics.height);
            const nodeId = currentGrid[row] && currentGrid[row][col];

            if (nodeId) {
                selectNode(nodeId);
                selectedInfo.textContent = 'Selected: ' + nodeId;
            }
        });

        // Double-click to edit content
        output.addEventListener('dblclick', e => {
            const rect = output.getBoundingClientRect();
            const col = Math.floor((e.clientX - rect.left) / metrics.width);
            const row = Math.floor((e.clientY - rect.top) / metrics.height);
            const nodeId = currentGrid[row] && currentGrid[row][col];

            if (nodeId) {
                selectedNodeId = nodeId;
                vscode.postMessage({ command: 'requestEditContent', nodeId });
            }
        });

        function showContentEditor(nodeId, content) {
            const bounds = findNodeBounds(nodeId);
            if (!bounds) return;

            const offsetX = output.offsetLeft;
            const offsetY = output.offsetTop;
            const app = document.getElementById('app');

            editOverlay.style.display = 'block';
            editOverlay.style.left = (offsetX + bounds.minC * metrics.width - app.scrollLeft) + 'px';
            editOverlay.style.top = (offsetY + bounds.minR * metrics.height - app.scrollTop) + 'px';
            editOverlay.style.width = ((bounds.maxC - bounds.minC + 1) * metrics.width) + 'px';
            editOverlay.style.height = ((bounds.maxR - bounds.minR + 1) * metrics.height) + 'px';

            editTextarea.value = content || '';
            editTextarea.focus();

            editTextarea.onkeydown = (ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault();
                    vscode.postMessage({ command: 'editNodeContent', nodeId, newContent: editTextarea.value });
                    editOverlay.style.display = 'none';
                } else if (ev.key === 'Escape') {
                    editOverlay.style.display = 'none';
                }
            };

            editTextarea.onblur = () => {
                editOverlay.style.display = 'none';
            };
        }

        // Right-click context menu
        output.addEventListener('contextmenu', e => {
            e.preventDefault();
            const rect = output.getBoundingClientRect();
            const col = Math.floor((e.clientX - rect.left) / metrics.width);
            const row = Math.floor((e.clientY - rect.top) / metrics.height);
            const nodeId = currentGrid[row] && currentGrid[row][col];

            if (!nodeId) return;

            selectedNodeId = nodeId;
            updateSelectedHighlight(nodeId);
            showContextMenu(e.clientX, e.clientY, nodeId);
        });

        const elementKinds = [
            { kind: 'panel', label: 'Panel' },
            { kind: 'header', label: 'Header' },
            { kind: 'nav', label: 'Nav' },
            { kind: 'table', label: 'Table' },
            { kind: 'list', label: 'List' },
            { kind: 'footer', label: 'Footer' },
            { kind: 'vstack', label: 'VStack Layout' },
            { kind: 'hstack', label: 'HStack Layout' },
        ];

        function showContextMenu(x, y, nodeId) {
            contextMenu.innerHTML = '';

            const items = [
                { label: 'Add Sibling Before...', action: () => showAddTypeMenu(nodeId, 'before') },
                { label: 'Add Sibling After...', action: () => showAddTypeMenu(nodeId, 'after') },
                { label: 'Add Child...', action: () => showAddTypeMenu(nodeId, 'child') },
                { sep: true },
                { label: 'Select Parent', action: () => vscode.postMessage({ command: 'selectParent', nodeId }) },
                { sep: true },
                { label: 'Change Kind...', action: () => showKindMenu(nodeId) },
                { label: 'Edit Content (double-click)', action: () => vscode.postMessage({ command: 'requestEditContent', nodeId }) },
                { sep: true },
                { label: 'Delete', action: () => deleteNode(nodeId) },
            ];

            for (const item of items) {
                if (item.sep) {
                    const sep = document.createElement('div');
                    sep.className = 'menu-separator';
                    contextMenu.appendChild(sep);
                } else {
                    const el = document.createElement('div');
                    el.className = 'menu-item';
                    el.textContent = item.label;
                    el.onclick = () => {
                        contextMenu.style.display = 'none';
                        item.action();
                    };
                    contextMenu.appendChild(el);
                }
            }

            contextMenu.style.display = 'block';
            contextMenu.style.left = x + 'px';
            contextMenu.style.top = y + 'px';
        }

        function showAddTypeMenu(nodeId, position) {
            contextMenu.innerHTML = '';

            const label = document.createElement('div');
            label.className = 'menu-label';
            const posLabel = position === 'before' ? 'before' : position === 'after' ? 'after' : 'as child';
            label.textContent = 'Add ' + posLabel + ':';
            contextMenu.appendChild(label);

            for (const el of elementKinds) {
                const item = document.createElement('div');
                item.className = 'menu-item';
                item.textContent = el.label;
                item.onclick = () => {
                    contextMenu.style.display = 'none';
                    addElementNear(el.kind, nodeId, position);
                };
                contextMenu.appendChild(item);
            }

            contextMenu.style.display = 'block';
        }

        function showKindMenu(nodeId) {
            const kinds = elementKinds.map(e => e.kind);
            contextMenu.innerHTML = '';

            const label = document.createElement('div');
            label.className = 'menu-label';
            label.textContent = 'Change kind to:';
            contextMenu.appendChild(label);

            for (const kind of kinds) {
                const el = document.createElement('div');
                el.className = 'menu-item';
                el.textContent = kind;
                el.onclick = () => {
                    contextMenu.style.display = 'none';
                    vscode.postMessage({ command: 'editNodeProperty', nodeId, property: 'kind', value: kind });
                };
                contextMenu.appendChild(el);
            }

            contextMenu.style.display = 'block';
        }

        document.addEventListener('click', e => {
            if (e.target !== contextMenu && !contextMenu.contains(e.target)) {
                contextMenu.style.display = 'none';
            }
        });

        // Delete key
        document.addEventListener('keydown', e => {
            if (e.key === 'Delete' && selectedNodeId && editOverlay.style.display === 'none') {
                e.preventDefault();
                deleteNode(selectedNodeId);
            }
        });

        function deleteNode(nodeId) {
            vscode.postMessage({ command: 'deleteNode', nodeId });
            selectedNodeId = null;
            selectedInfo.textContent = 'No selection';
            updateHighlight(null);
            updateSelectedHighlight(null);
        }

        function deleteSelected() {
            if (selectedNodeId) {
                deleteNode(selectedNodeId);
            }
        }

        function addElement(kind) {
            if (selectedNodeId) {
                addElementNear(kind, selectedNodeId, 'after');
            } else {
                // Add at root level - use first node as reference
                if (currentGrid.length > 0) {
                    for (let r = 0; r < currentGrid.length; r++) {
                        for (let c = 0; c < currentGrid[r].length; c++) {
                            if (currentGrid[r][c]) {
                                addElementNear(kind, currentGrid[r][c], 'after');
                                return;
                            }
                        }
                    }
                }
            }
        }

        function addElementNear(kind, targetNodeId, position) {
            vscode.postMessage({ command: 'addNode', kind, targetNodeId, position });
        }
    </script>
</body>
</html>`;
    }

    private _escapeHtml(unsafe: string) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
}
