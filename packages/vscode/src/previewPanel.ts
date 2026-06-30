import * as vscode from 'vscode';
import * as path from 'path';
import { outputChannel } from './extension'; // Import from extension

export class PreviewPanel {
    public static readonly viewType = 'asciiwirePreview';
    public static currentPanel: PreviewPanel | undefined;
    private _ascii: string = '';
    private _lastNodes: any[] = [];
    private _lastWidth: number = 80;
    private _document: vscode.TextDocument | undefined;

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

        // Otherwise, create a new panel.
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

        // Store the document being previewed
        this._document = vscode.window.activeTextEditor?.document;
        this._update(this._document);
        
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

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
                }
            },
            null,
            this._disposables
        );
    }

    private _onResizeNode(nodeId: string, dw: number, dh: number) {
        outputChannel.appendLine(`Resizing node: ${nodeId} by ${dw},${dh}`);
        try {
        const node = this._findNodeById(this._lastNodes, nodeId);
        const parent = this._findParentOfNode(this._lastNodes, nodeId);

        if (!node || !node.sourceRange) {
            vscode.window.showErrorMessage(`Resize failed: node ${nodeId} not found or no sourceRange`);
            return;
        }

        const editor = this._getEditor();
        if (!editor) {
            vscode.window.showErrorMessage(`Resize failed: no editor found for ${nodeId}`);
            return;
        }

        editor.edit(editBuilder => {
            // Height adjustment (Vertical) - update height=N parameter
            if (dh !== 0) {
                const currentHeight = parseInt(node.params?.height || '0', 10);
                const contentLines = node.content.split('\n').filter((l: string) => l.trim() !== '').length;
                const newHeight = Math.max(contentLines, currentHeight + dh);
                const line = editor.document.lineAt(node.sourceRange.startLine);
                const heightRegex = /height=\d+/;
                let newText: string;
                if (line.text.match(heightRegex)) {
                    newText = line.text.replace(heightRegex, `height=${newHeight}`);
                } else {
                    newText = line.text.replace(/^(@\S+\s+\S+.*)$/, `$1 height=${newHeight}`);
                }
                editBuilder.replace(line.range, newText);
                outputChannel.appendLine(`Resize: updated height=${newHeight} (was ${currentHeight}, dh=${dh})`);
            }

            // Width adjustment (Horizontal)
            if (dw !== 0) {
                if (parent && parent.kind === 'split') {
                    const currentRatio = this._getSplitRatio(parent);
                    const deltaRatio = Math.round((dw / this._lastWidth) * 100);
                    const newRatio = Math.max(5, Math.min(95, currentRatio + deltaRatio));
                    const ratioLine = editor.document.lineAt(parent.sourceRange.startLine);
                    const ratioRegex = /\b(\d+)\/(\d+)\b/;
                    let newText: string;
                    if (ratioLine.text.match(ratioRegex)) {
                        newText = ratioLine.text.replace(ratioRegex, `${newRatio}/${100 - newRatio}`);
                    } else {
                        newText = ratioLine.text.replace(/^(@layout\s+split)$/, `$1 ratio=${newRatio}/${100 - newRatio}`);
                    }
                    editBuilder.replace(ratioLine.range, newText);
                } else {
                    const currentWidth = parseInt(node.params?.width || '80', 10);
                    const line = editor.document.lineAt(node.sourceRange.startLine);
                    const regex = new RegExp(`width=\\d+`);
                    let newText: string;
                    if (line.text.match(regex)) {
                        newText = line.text.replace(regex, `width=${currentWidth + dw}`);
                    } else {
                        newText = line.text.replace(/^(@\S+\s+\S+.*)$/, `$1 width=${currentWidth + dw}`);
                    }
                    editBuilder.replace(line.range, newText);
                }
            }
        }).then(() => {
            this._update(editor.document);
        }, (err: any) => {
            outputChannel.appendLine(`Resize edit error: ${err}`);
            outputChannel.appendLine(`Stack: ${err?.stack}`);
        });
        } catch (err) {
            outputChannel.appendLine(`Resize error: ${err}`);
            outputChannel.appendLine(`Stack: ${(err as Error)?.stack}`);
        }
    }

    private _onMoveNode(nodeId: string, dx: number, dy: number) {
        outputChannel.appendLine(`Moving node: ${nodeId} by ${dx},${dy}`);
        const node = this._findNodeById(this._lastNodes, nodeId);
        const parent = this._findParentOfNode(this._lastNodes, nodeId);
        
        if (!node || !node.sourceRange) return;

        const editor = this._getEditor();
        if (!editor) return;

        try {
        editor.edit(editBuilder => {
            // Horizontal: adjust split ratio
            if (parent && parent.kind === 'split' && dx !== 0) {
                const currentRatio = this._getSplitRatio(parent);
                const deltaRatio = Math.round((dx / this._lastWidth) * 100);
                const newRatio = Math.max(5, Math.min(95, currentRatio + deltaRatio));
                const line = editor.document.lineAt(parent.sourceRange.startLine);
                const ratioRegex = /\b(\d+)\/(\d+)\b/;
                let newText: string;
                if (line.text.match(ratioRegex)) {
                    newText = line.text.replace(ratioRegex, `${newRatio}/${100 - newRatio}`);
                } else {
                    newText = line.text.replace(/\bsplit\b/, `split ${newRatio}/${100 - newRatio}`);
                }
                editBuilder.replace(line.range, newText);
            }

            // Vertical: reorder siblings
            if (dy !== 0 && parent && parent.children) {
                const siblings = parent.children;
                const index = siblings.indexOf(node);
                if (index !== -1) {
                    const newIndex = dy > 0 ? index + 1 : index - 1;
                    if (newIndex >= 0 && newIndex < siblings.length) {
                        const sibling = siblings[newIndex];
                        if (!node.sourceRange || !sibling.sourceRange) return;
                        const rangeA = new vscode.Range(
                            new vscode.Position(node.sourceRange.startLine, 0),
                            new vscode.Position(node.sourceRange.endLine + 1, 0)
                        );
                        const rangeB = new vscode.Range(
                            new vscode.Position(sibling.sourceRange.startLine, 0),
                            new vscode.Position(sibling.sourceRange.endLine + 1, 0)
                        );
                        const textA = editor.document.getText(rangeA);
                        const textB = editor.document.getText(rangeB);
                        if (node.sourceRange.startLine < sibling.sourceRange.startLine) {
                            editBuilder.replace(rangeB, textA);
                            editBuilder.replace(rangeA, textB);
                        } else {
                            editBuilder.replace(rangeA, textB);
                            editBuilder.replace(rangeB, textA);
                        }
                    }
                }
            }
        }).then(() => {
            this._update(editor.document);
        }, (err: any) => {
            outputChannel.appendLine(`Move edit error: ${err}`);
            outputChannel.appendLine(`Stack: ${err?.stack}`);
        });
        } catch (err) {
            outputChannel.appendLine(`Move error: ${err}`);
            outputChannel.appendLine(`Stack: ${(err as Error)?.stack}`);
        }
    }

    private _reorderSiblings(siblings: any[], node: any, dy: number) {
        const index = siblings.indexOf(node);
        if (index === -1) return;

        // Simplified: move one up or one down
        const newIndex = dy > 0 ? index + 1 : index - 1;
        if (newIndex >= 0 && newIndex < siblings.length) {
            const sibling = siblings[newIndex];
            this._swapDSLBlocks(node, sibling);
        }
    }

    private _swapDSLBlocks(nodeA: any, nodeB: any) {
        const editor = this._getEditor();
        if (!editor || !nodeA.sourceRange || !nodeB.sourceRange) return;

        const rangeA = new vscode.Range(
            new vscode.Position(nodeA.sourceRange.startLine, 0),
            new vscode.Position(nodeA.sourceRange.endLine + 1, 0)
        );
        const rangeB = new vscode.Range(
            new vscode.Position(nodeB.sourceRange.startLine, 0),
            new vscode.Position(nodeB.sourceRange.endLine + 1, 0)
        );

        const textA = editor.document.getText(rangeA);
        const textB = editor.document.getText(rangeB);

        editor.edit(editBuilder => {
            if (nodeA.sourceRange.startLine < nodeB.sourceRange.startLine) {
                editBuilder.replace(rangeB, textA);
                editBuilder.replace(rangeA, textB);
            } else {
                editBuilder.replace(rangeA, textB);
                editBuilder.replace(rangeB, textA);
            }
        }).then(() => {
            this._update(editor.document);
        });
    }

    private _getSplitRatio(node: any): number {
        const ratioParam = node.params?.ratio || node.params?.value;
        if (ratioParam) {
            if (ratioParam.includes('/')) {
                const [left, right] = ratioParam.split('/').map((n: string) => parseInt(n, 10));
                if (!isNaN(left) && !isNaN(right)) {
                    return Math.round((left / (left + right)) * 100);
                }
            } else if (!isNaN(parseFloat(ratioParam))) {
                return parseFloat(ratioParam);
            }
        }
        return 50;
    }

    private _updateSplitRatio(node: any, newRatio: number) {
        const editor = this._getEditor();
        if (!editor || !node.sourceRange) return;

        const line = editor.document.lineAt(node.sourceRange.startLine);
        const text = line.text;

        const ratioRegex = /\b(\d+)\/(\d+)\b/;
        let newText: string;
        if (text.match(ratioRegex)) {
            newText = text.replace(ratioRegex, `${newRatio}/${100 - newRatio}`);
        } else {
            newText = text.replace(/\bsplit\b/, `split ${newRatio}/${100 - newRatio}`);
        }

        editor.edit(editBuilder => {
            editBuilder.replace(line.range, newText);
        }).then(() => {
            this._update(editor.document);
        });
    }

    private _updateDSLProperty(node: any, key: string, value: any) {
        const editor = this._getEditor();
        if (!editor || !node.sourceRange) return;

        const line = editor.document.lineAt(node.sourceRange.startLine);
        const text = line.text;
        
        // Try to update existing key=value parameter
        const regex = new RegExp(`${key}=\\\\d+`);
        let newText: string;
        if (text.match(regex)) {
            newText = text.replace(regex, `${key}=${value}`);
        } else {
            // Append key=value after the heading content (e.g. "### component: panel" -> "### component: panel width=80")
            newText = text.replace(/^(#+\s+\S+:\s+\S+)\s*$/, `$1 ${key}=${value}`);
        }

        editor.edit(editBuilder => {
            editBuilder.replace(line.range, newText);
        }).then(() => {
            this._update(editor.document);
        });
    }

    private _getEditor(): vscode.TextEditor | undefined {
        // First try to find a visible editor for the stored document
        if (this._document) {
            const editor = vscode.window.visibleTextEditors.find(e =>
                e.document.uri.toString() === this._document!.uri.toString()
            );
            if (editor) return editor;
        }
        // Fallback: find any visible .wire.md editor
        return vscode.window.visibleTextEditors.find(e =>
            e.document.fileName.endsWith('.wire.md')
        ) || vscode.window.activeTextEditor;
    }

    private _findParentOfNode(nodes: any[], nodeId: string, parent: any = null): any {
        for (const node of nodes) {
            if (node.id === nodeId) return parent;
            if (node.children) {
                const found = this._findParentOfNode(node.children, nodeId, node);
                if (found) return found;
            }
        }
        return null;
    }

    private _onSelectNode(nodeId: string) {
        outputChannel.appendLine(`Selecting node: ${nodeId}`);
        const node = this._findNodeById(this._lastNodes, nodeId);
        if (node) {
            outputChannel.appendLine(`Found node: ${node.kind} at range ${node.sourceRange?.startLine}-${node.sourceRange?.endLine}`);
            if (node.sourceRange) {
                const editor = this._getEditor();

                if (editor) {
                    const start = new vscode.Position(node.sourceRange.startLine, 0);
                    const end = new vscode.Position(node.sourceRange.endLine + 1, 0);
                    const range = new vscode.Range(start, end);
                    
                    // Focus the editor first to ensure selection is visible
                    vscode.window.showTextDocument(editor.document, editor.viewColumn, false).then(ed => {
                        ed.selection = new vscode.Selection(start, end);
                        ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                    });
                }
            }
        } else {
            outputChannel.appendLine(`Node not found in current AST: ${nodeId}`);
        }
    }

    private _findNodeById(nodes: any[], nodeId: string): any {
        for (const node of nodes) {
            if (node.id === nodeId) {
                return node;
            }
            if (node.children) {
                const found = this._findNodeById(node.children, nodeId);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }

    public dispose() {
        PreviewPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _isFirstUpdate: boolean = true;

    private _update(document?: vscode.TextDocument) {
        const webview = this._panel.webview;
        const text = document ? document.getText() : '';
        
        try {
            this._lastWidth = 80; // Default width
            const result = this._render(text);
            this._ascii = typeof result === 'string' ? result : result.ascii;
            const grid = typeof result === 'string' ? [] : result.grid;
            this._lastNodes = result.nodes || []; // Capture nodes

            if (this._isFirstUpdate) {
                // Set HTML only on first update so postMessage listeners persist
                this._panel.webview.html = this._getHtmlForWebview(webview, this._ascii, grid);
                this._isFirstUpdate = false;
            } else if (this._panel.visible) {
                this._panel.webview.postMessage({ 
                    command: 'update', 
                    content: this._ascii,
                    grid: grid
                });
            }
        } catch (e) {
            this._panel.webview.html = `Error: ${e}`;
        }
    }

    private _render(text: string): any {
        try {
            let core;
            try {
                core = require('@asciiwire/core');
            } catch (e) {
                const corePath = path.join(this._extensionUri.fsPath, '..', 'core', 'dist', 'index.js');
                outputChannel.appendLine(`Loading core from: ${corePath}`);
                core = require(corePath);
            }
            
            if (!core || typeof core.parseDSL !== 'function') {
                throw new Error('Could not find ASCIIwire core components');
            }

            const nodes = core.parseDSL(text);
            const rendered = core.renderASCII(nodes);
            return {
                ...rendered,
                nodes // Include nodes in the return object
            };
        } catch (err) {
            outputChannel.appendLine(`Render error: ${err}`);
            outputChannel.appendLine(`Stack: ${(err as Error).stack}`);
            return `Error rendering ASCII: ${err}`;
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview, content: string, grid: any[] = []) {
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview', 'styles.css'));
        
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
        #ascii-output {
            position: relative;
            cursor: crosshair;
            user-select: none;
            padding: 0;
            margin: 0;
            white-space: pre;
            display: inline-block; /* Ensure rect matches content */
        }
        .highlight-overlay {
            position: absolute;
            background: rgba(0, 122, 204, 0.2);
            border: 1px solid #007acc;
            pointer-events: none; /* Let mouse events pass through to <pre> */
            z-index: 100;
            transition: none;
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
            pointer-events: auto; /* Override parent's none — works in Chromium */
        }
    </style>
</head>
<body>
    <div id="app" style="overflow: auto; width: 100vw; height: 100vh; position: relative;">
        <div id="content-wrapper" style="position: relative; display: inline-block;">
            <pre id="ascii-output">${this._escapeHtml(content)}</pre>
            <div id="overlay-container" style="position: absolute; top: 0; left: 0; pointer-events: none;"></div>
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        let currentGrid = ${JSON.stringify(grid)};
        const output = document.getElementById('ascii-output');
        const overlayContainer = document.getElementById('overlay-container');

        // Better Metrics measurement
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

        function updateHighlight(nodeId, dx = 0, dy = 0, dw = 0, dh = 0) {
            overlayContainer.innerHTML = '';
            if (!nodeId) return;

            let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
            let found = false;
            for (let r = 0; r < currentGrid.length; r++) {
                for (let c = 0; c < currentGrid[r].length; c++) {
                    if (currentGrid[r][c] === nodeId) {
                        minR = Math.min(minR, r);
                        maxR = Math.max(maxR, r);
                        minC = Math.min(minC, c);
                        maxC = Math.max(maxC, c);
                        found = true;
                    }
                }
            }

            if (found) {
                const offsetX = output.offsetLeft;
                const offsetY = output.offsetTop;

                const overlay = document.createElement('div');
                overlay.className = 'highlight-overlay';
                overlay.style.top = (offsetY + (minR + dy) * metrics.height) + 'px';
                overlay.style.left = (offsetX + (minC + dx) * metrics.width) + 'px';
                overlay.style.width = ((maxC - minC + 1 + dw) * metrics.width) + 'px';
                overlay.style.height = ((maxR - minR + 1 + dh) * metrics.height) + 'px';
                
                if (isDragging || isResizing) {
                    overlay.style.background = isResizing ? 'rgba(255, 165, 0, 0.4)' : 'rgba(0, 122, 204, 0.4)';
                    overlay.style.border = isResizing ? '2px solid orange' : '2px solid #007acc';
                }

                // Add resize handle
                const handle = document.createElement('div');
                handle.className = 'resize-handle';
                // We need to capture mousedown on the handle
                handle.onmousedown = (e) => {
                    isResizing = true;
                    draggedNodeId = nodeId;
                    dragStart = { x: e.clientX, y: e.clientY };
                    e.stopPropagation();
                    e.preventDefault();
                };
                overlay.appendChild(handle);

                overlayContainer.appendChild(overlay);
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'update') {
                output.textContent = message.content;
                currentGrid = message.grid || [];
                metrics = getMetrics();
                updateHighlight(null);
            }
        });

        output.addEventListener('mousedown', e => {
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
            }
        });

        let didDrag = false;

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
                vscode.postMessage({ command: 'selectNode', nodeId });
            }
        });
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
