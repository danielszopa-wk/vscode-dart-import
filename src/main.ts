import * as vscode from 'vscode';
interface PackageInfo {
    projectRoot: string;
    projectName: string;
}

const relativize = (filePath: string, importPath: string, pathSep: string) => {
    const dartSep = '/'; // dart uses this separator for imports no matter the platform
    const pathSplit = (path: string, sep: string) => path.length === 0 ? [] : path.split(sep);
    const fileBits = pathSplit(filePath, pathSep);
    const importBits = pathSplit(importPath, dartSep);
    let dotdotAmount = 0, startIdx;
    for (startIdx = 0; startIdx < fileBits.length; startIdx++) {
        if (fileBits[startIdx] === importBits[startIdx]) {
            continue;
        }
        dotdotAmount = fileBits.length - startIdx;
        break;
    }
    const relativeBits = new Array(dotdotAmount).fill('..').concat(importBits.slice(startIdx));
    return relativeBits.join(dartSep);
};

interface EditorAccess {
    getFileName(): string;
    getLineAt(idx: number): string;
    getLineCount(): number;
    replaceLineAt(idx: number, newLine: string): Thenable<boolean>;
}

const fixImports = async (editor: EditorAccess, packageInfo: PackageInfo, pathSep: string): Promise<number> => {
    const oc = vscode.window.createOutputChannel('vscode-dart-import2');
    const currentPath = editor.getFileName().replace(/(\/|\\)[^\/\\]*.dart$/, '');
    oc.appendLine(`currentPath ${currentPath}`);
    const libFolder = `${packageInfo.projectRoot}${pathSep}lib`;
    if (!currentPath.startsWith(libFolder)) {
        const l1 = 'Current file is not on project root or not on lib folder? File must be on $root/lib.';
        const l2 = `Your current file path is: '${currentPath}' and the lib folder according to the pubspec.yaml file is '${libFolder}'.`;
        throw Error(`${l1}\n${l2}`);
    }
    const relativePath = currentPath.substring(libFolder.length + 1);
    oc.appendLine(`relativePath: ${relativePath}`);
    const lineCount = editor.getLineCount();
    let count = 0;
    for (let currentLine = 0; currentLine < lineCount; currentLine++) {
        const line: string = editor.getLineAt(currentLine);
        if (line.trim().length === 0) {
            continue;
        }
        const content = line.trim();
        if (!content.startsWith('import ')) {
            break;
        }
        const regex = new RegExp(`^\\s*import\\s*(['"])package:${packageInfo.projectName}/([^'"]*)['"]([^;]*);\\s*$`);
        const exec = regex.exec(content);
        if (exec) {
            const quote = exec[1];
            const importPath = exec[2];
            const ending = exec[3];
            const relativeImport = relativize(relativePath, importPath, pathSep);
            const content = `import ${quote}${relativeImport}${quote}${ending};`;
            await editor.replaceLineAt(currentLine, content);
            count++;
        }
    }
    return count;
};

const fixImports2 = async (textDoc: vscode.TextDocument, packageInfo: PackageInfo, pathSep: string): Promise<number> => {
    const currentPath = textDoc.fileName.replace(/(\/|\\)[^\/\\]*.dart$/, '');
    const libFolder = `${packageInfo.projectRoot}${pathSep}lib`;

    if (!currentPath.startsWith(libFolder)) {
        const l1 = 'Current file is not on project root or not on lib folder? File must be on $root/lib.';
        const l2 = `Your current file path is: '${currentPath}' and the lib folder according to the pubspec.yaml file is '${libFolder}'.`;
        throw Error(`${l1}\n${l2}`);
    }

    const relativePath = currentPath.substring(libFolder.length + 1);
    const lineCount = textDoc.lineCount;

    let count = 0;
    for (let currentLine = 0; currentLine < lineCount; currentLine++) {
        const line: string = textDoc.lineAt(currentLine).text;
        if (line.trim().length === 0) {
            continue;
        }

        const content = line.trim();
        if (!content.startsWith('import ')) {
            break;
        }

        const regex = new RegExp(`^\\s*import\\s*(['"])package:${packageInfo.projectName}/([^'"]*)['"]([^;]*);\\s*$`);
        const exec = regex.exec(content);
        if (exec) {
            const quote = exec[1];
            const importPath = exec[2];
            const ending = exec[3];
            const relativeImport = relativize(relativePath, importPath, pathSep);
            const content = `import ${quote}${relativeImport}${quote}${ending};`;

            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.replace(
                textDoc.uri,
                new vscode.Range(currentLine, 0, currentLine, content.length),
                content
            );
            const success = await vscode.workspace.applyEdit(workspaceEdit);
            if (success) {
                vscode.window.showInformationMessage('Success in ' + relativePath);
            }

            count++; 
        }
    }
    return count;
}

export { PackageInfo, relativize, EditorAccess, fixImports, fixImports2 };