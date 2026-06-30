import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';

export const outputChannel = vscode.window.createOutputChannel('ASCIIwire');

export function activate(context: vscode.ExtensionContext) {
    outputChannel.appendLine('ASCIIwire extension is now active');

    // Create status bar item FIRST
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(eye) ASCIIwire';
    statusBarItem.command = 'asciiwire.openPreview';
    statusBarItem.tooltip = 'Click to open ASCIIwire Preview';
    context.subscriptions.push(statusBarItem);

    const disposable = vscode.commands.registerCommand('asciiwire.openPreview', () => {
        try {
            PreviewPanel.createOrShow(context.extensionUri);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to open preview: ${e}`);
        }
    });

    const copyASCII = vscode.commands.registerCommand('asciiwire.copyASCII', async () => {
        const ascii = PreviewPanel.currentAscii;
        if (ascii) {
            await vscode.env.clipboard.writeText(ascii);
            vscode.window.showInformationMessage('ASCII Art copied to clipboard!');
        } else {
            vscode.window.showWarningMessage('Nothing to copy. Make sure a preview is active.');
        }
    });

    const copyDSL = vscode.commands.registerCommand('asciiwire.copyDSL', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await vscode.env.clipboard.writeText(editor.document.getText());
            vscode.window.showInformationMessage('DSL copied to clipboard!');
        }
    });

    const copyBoth = vscode.commands.registerCommand('asciiwire.copyBoth', async () => {
        const ascii = PreviewPanel.currentAscii;
        const editor = vscode.window.activeTextEditor;
        if (ascii && editor) {
            const dsl = editor.document.getText();
            const both = `${ascii}\n\n<!-- asciiwire-dsl\n${dsl}\n-->`;
            await vscode.env.clipboard.writeText(both);
            vscode.window.showInformationMessage('ASCII Art and DSL copied to clipboard!');
        } else {
            vscode.window.showWarningMessage('Nothing to copy. Make sure a preview and editor are active.');
        }
    });

    context.subscriptions.push(disposable, copyASCII, copyDSL, copyBoth);

    const updateStatusBar = (editor: vscode.TextEditor | undefined) => {
        try {
            if (editor && (editor.document.languageId === 'wire' || editor.document.fileName.endsWith('.wire'))) {
                statusBarItem.show();
            } else {
                statusBarItem.hide();
            }
        } catch (e) {
            outputChannel.appendLine(`Error updating status bar: ${e}`);
        }
    };

    vscode.window.onDidChangeActiveTextEditor(updateStatusBar, null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.fileName.endsWith('.wire')) {
            try {
                PreviewPanel.update(e.document);
            } catch (err) {
                outputChannel.appendLine(`Error updating preview: ${err}`);
            }
        }
    }, null, context.subscriptions);

    // Initial check
    updateStatusBar(vscode.window.activeTextEditor);
    
    vscode.window.showInformationMessage('ASCIIwire Extension Activated');
}

export function deactivate() {}
