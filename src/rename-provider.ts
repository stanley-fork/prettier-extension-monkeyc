import { hasProperty, isStateNode } from "@markw65/monkeyc-optimizer/api.js";
import * as vscode from "vscode";
import { findDefinition, visitReferences } from "./project-manager.js";

export class MonkeyCRenameProvider implements vscode.RenameProvider {
  getRenameInfo(document: vscode.TextDocument, position: vscode.Position) {
    return findDefinition(document, position).then(
      ({ node, name, results, where, analysis }) => {
        if (
          name &&
          where &&
          where.length &&
          results &&
          results.length === 1 &&
          (node.type === "Identifier" || node.type === "MemberExpression")
        ) {
          const back = where[where.length - 1];
          // - an identifier defined in a block (a local) or function
          //   (a parameter) can always be renamed.
          // - an identifier defined in a module can be renamed unless
          //   the program uses its symbol in unknown ways.
          if (
            back.type !== "BlockStatement" &&
            back.type !== "FunctionDeclaration" &&
            ((back.type !== "ModuleDeclaration" && back.type !== "Program") ||
              hasProperty(analysis.state.exposed, name))
          ) {
            return Promise.reject(`Unable to rename ${name}`);
          }
          const id = node.type === "Identifier" ? node : node.property;
          if (id.type === "Identifier") {
            if (id.name === "$") {
              return Promise.reject(`Can't rename the global module`);
            }
            const origin = isStateNode(results[0])
              ? results[0].node
              : results[0];
            return { id, where, analysis, source: origin?.loc?.source };
          }
        }
        return Promise.reject("No renamable symbol found");
      }
    );
  }

  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position,
    _cancellationToken: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Range> {
    return this.getRenameInfo(document, position).then(({ id, source }) => {
      if (source == "api.mir") {
        return Promise.reject("Can't rename Toybox api entities");
      }
      return new vscode.Range(
        id.loc!.start.line - 1,
        id.loc!.start.column - 1,
        id.loc!.end.line - 1,
        id.loc!.end.column - 1
      );
    });
  }

  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.WorkspaceEdit> {
    return this.getRenameInfo(document, position)
      .then(({ id, where, analysis }) => {
        const back = where[where.length - 1];
        const edits = new vscode.WorkspaceEdit();
        const files =
          back.type == "BlockStatement" || back.type === "FunctionDeclaration"
            ? [document.uri.fsPath]
            : Object.keys(analysis.fnMap);
        files.forEach((name) => {
          const file = analysis.fnMap[name];
          visitReferences(analysis.state, file.ast, id.name, where, (node) => {
            const n = node.type === "MemberExpression" ? node.property : node;
            const loc = n.loc!;
            edits.replace(
              vscode.Uri.file(name),
              new vscode.Range(
                loc.start.line - 1,
                loc.start.column - 1,
                loc.end.line - 1,
                loc.end.column - 1
              ),
              newName
            );
          });
        });
        return edits;
      })
      .catch(() => null);
  }
}
