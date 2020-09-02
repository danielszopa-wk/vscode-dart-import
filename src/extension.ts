'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PackageInfo, EditorAccess, fixImports, relativize } from './main';

/**
 * Returns the set of `pubspec.yaml` files that sit above `activeFileUri` in its
 * directory ancestry.
 */
const findPubspec = async (activeFileUri: vscode.Uri) => {
    const allPubspecUris = await vscode.workspace.findFiles('**/pubspec.yaml');
    return allPubspecUris.filter((pubspecUri) => {
        const packageRootUri = pubspecUri.with({
            path: path.dirname(pubspecUri.path),
        }) + '/';

        // Containment check
        return activeFileUri.toString().startsWith(packageRootUri.toString());
    });
};

const fetchPackageInfoFor = async (activeDocumentUri: vscode.Uri): Promise<PackageInfo | null> => {
    const pubspecUris = await findPubspec(activeDocumentUri);
    if (pubspecUris.length !== 1) {
        vscode.window.showErrorMessage(`Expected to find a single pubspec.yaml file above ${activeDocumentUri}, ${pubspecUris.length} found.`);
        return null;
    }

    const pubspec: vscode.TextDocument = await vscode.workspace.openTextDocument(pubspecUris[0]);
    const projectRoot = path.dirname(pubspec.fileName);
    const possibleNameLines = pubspec.getText().split('\n').filter((line: string) => line.match(/^name:/));
    if (possibleNameLines.length !== 1) {
        vscode.window.showErrorMessage(`Expected to find a single line starting with 'name:' on pubspec.yaml file, ${possibleNameLines.length} found.`);
        return null;
    }
    const nameLine = possibleNameLines[0];
    const packageNameMatch = /^name:\s*(.*)$/mg.exec(nameLine);
    if (!packageNameMatch) {
        vscode.window.showErrorMessage(`Expected line 'name:' on pubspec.yaml to match regex, but it didn't (line: ${nameLine}).`);
        return null;
    }
    return {
        projectRoot: projectRoot,
        projectName: packageNameMatch[1].trim(),
    };
};

class VSCodeEditorAccess implements EditorAccess {
    editor: vscode.TextEditor;

    constructor(editor: vscode.TextEditor) {
        this.editor = editor;
    }

    getFileName(): string {
        return this.editor.document.fileName;
    }

    getLineAt(idx: number): string {
        return this.editor.document.lineAt(idx).text;
    }

    getLineCount(): number {
        return this.editor.document.lineCount;
    }

    replaceLineAt(idx: number, newLine: string): Thenable<boolean> {
        return this.editor.edit((builder) => {
            const line = this.getLineAt(idx);
            const start = new vscode.Position(idx, 0);
            const end = new vscode.Position(idx, line.length);
            builder.replace(new vscode.Range(start, end), newLine);
        });
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const cmd = vscode.commands.registerCommand('dart-import.fix', async () => {
        const rawEditor = vscode.window.activeTextEditor;
        if (!rawEditor) {
            return; // No open text editor
        }

        const packageInfo = await fetchPackageInfoFor(rawEditor.document.uri);
        if (!packageInfo) {
            vscode.window.showErrorMessage('Failed to initialize extension. Is this a valid Dart/Flutter project?');
            return;
        }

        const editor = new VSCodeEditorAccess(rawEditor);
        try {
            const count = await fixImports(editor, packageInfo, path.sep);
            vscode.commands.executeCommand('editor.action.organizeImports');
            vscode.window.showInformationMessage((count === 0 ? 'No lines changed.' : `${count} imports fixed.`) + ' All imports sorted.');
        } catch (ex) {
            if (ex instanceof Error) {
                vscode.window.showErrorMessage(ex.message);
            } else {
                throw ex;
            }
        }
    });
    context.subscriptions.push(cmd);

    const cmd2 = vscode.commands.registerCommand('dart-import.fix-all', async () => {
        const oc = vscode.window.createOutputChannel('vscode-dart-import');
        oc.appendLine('RootPath: ' + vscode.workspace.rootPath);

        // Find all dart files in the lib folder.
        const dartFiles = await vscode.workspace.findFiles("lib/**/*.dart");
        oc.appendLine('Dart Files: ' + dartFiles.toString());

        vscode.extensions.getExtension('ext')?.exports


        for (let dartFile of dartFiles) {
            // const filename = path.basename(dartFile.fsPath);
            const filename = dartFile.fsPath;
            const currentPath = filename.replace(/(\/|\\)[^\/\\]*.dart$/, '');
            oc.appendLine(`currentPath: ${currentPath}`);

            // Grab the package info.
            const packageInfo = await fetchPackageInfoFor(dartFile);
            if (!packageInfo) {
                vscode.window.showErrorMessage('Failed to initialize extension. Is this a valid Dart/Flutter project?');
                return null;
            }

            const libFolder = `${packageInfo.projectRoot}${path.sep}lib`;
            const relativePath = currentPath.substring(libFolder.length + 1);
            oc.appendLine(`relativePath: ${relativePath}`);

            fs.readFile(dartFile.path, (exception, data) => {
                if (exception) {
                    vscode.window.showErrorMessage(exception.message);
                }

                let strData = data.toString();
                const lines = strData.split('\n');

                for (let line of lines) {
                    if (line.trim().startsWith('import ')) {
                        const regex = new RegExp(`^\\s*import\\s*(['"])package:${packageInfo.projectName}/([^'"]*)['"]([^;]*);\\s*$`);
                        const exec = regex.exec(line);

                        if (exec) {
                            const quote = exec[1];
                            const importPath = exec[2];
                            const ending = exec[3];
                            const relativeImport = relativize(relativePath, importPath, path.sep);
                            const content = `import ${quote}${relativeImport}${quote}${ending};`;

                            // oc.appendLine(`replacing line: ${line}`);
                            // oc.appendLine(`with: ${content}`);

                            strData = strData.replace(line, content);
                        }
                    }
                }

                oc.appendLine(`Writing to file: ${dartFile.path}`);
                // oc.appendLine(`old data: ${data.toString()}`);
                // oc.appendLine(`new data: ${strData}`);

                
                fs.writeFile(dartFile.path, strData, 'utf8', (err) => {
                    if (!err) {
                        return;
                    }
                    vscode.window.showErrorMessage(err.message);
                });
            });
        }
    });
    context.subscriptions.push(cmd2);
}
