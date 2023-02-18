import { Analysis, display, StateNodeDecl } from "@markw65/monkeyc-optimizer";
import {
  formatAstLongLines,
  isLocal,
  isStateNode,
  visitReferences,
} from "@markw65/monkeyc-optimizer/api.js";
import { ExactOrUnion } from "@markw65/monkeyc-optimizer/build/src/type-flow/types";
import { mctree } from "@markw65/prettier-plugin-monkeyc";
import * as vscode from "vscode";
import { findAnalysis, skipToPosition } from "./project-manager";

type HoverItem = {
  node: mctree.Node;
  type?: ExactOrUnion;
  decls: StateNodeDecl[];
};

export class MonkeyCHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _cancellationToken: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    return findAnalysis(
      document,
      (analysis, ast, fileName, isLastGood, project) => {
        if (!analysis.typeMap) {
          return null;
        }
        const functionDocumentation =
          project.getFunctionDocumentation() || Promise.resolve(null);
        const result = findHoverByRange(analysis, ast, fileName, position);
        if (!result) return null;
        const [self, parent] = result;
        return functionDocumentation.then((docinfo) => {
          const hoverTexts: string[] = [];
          const typeString = self.type
            ? display(self.type).replace(/[<>]/g, "\\$&")
            : null;
          if (parent && parent.node.type === "CallExpression") {
            if (self.node === parent.node.callee) {
              hoverTexts.push(
                ...self.decls
                  .map((decl) => {
                    if (decl.type !== "FunctionDeclaration") {
                      return null;
                    }
                    const body = decl.node.body;
                    decl.node.body = null;
                    const result = formatAstLongLines(decl.node);
                    decl.node.body = body;
                    const doc = docinfo?.get(decl.fullName);
                    return doc ? `${result}\n\n${doc}` : result;
                  })
                  .filter((s): s is string => s != null)
              );
            } else {
              const arg = parent.node.arguments.indexOf(
                self.node as mctree.Expression
              );
              if (arg >= 0) {
                hoverTexts.push(
                  `${formatAstLongLines(parent.node.callee)}  \nargument (${
                    arg + 1
                  })${typeString ? `: ${typeString}` : ""}`
                );
              }
            }
          }
          if (!hoverTexts.length) {
            hoverTexts.push(
              ...self.decls
                .map((decl) => {
                  let result = "";
                  let doc: string | undefined;
                  if (isStateNode(decl)) {
                    if (decl.type !== "VariableDeclarator" || !isLocal(decl)) {
                      result += decl.fullName;
                    } else {
                      result += decl.name;
                    }
                    doc = docinfo?.get(decl.fullName);
                  } else {
                    result += formatAstLongLines(decl);
                  }
                  if (typeString && decl.type === "VariableDeclarator") {
                    result += ` (${typeString})`;
                  }
                  if (doc) {
                    result += "\n\n" + doc;
                  }
                  return result.length ? result : null;
                })
                .filter((s): s is string => s != null)
            );
          }
          if (!hoverTexts.length) {
            return null;
          }
          return new vscode.Hover(
            hoverTexts.map((t) => new vscode.MarkdownString(t))
          );
        });

        return null;
      }
    );
  }
}

function findHoverByRange(
  analysis: Analysis,
  ast: mctree.Program,
  fileName: string,
  position: vscode.Position
): [HoverItem, HoverItem | undefined] | null {
  const results = [] as Array<HoverItem>;
  visitReferences(
    analysis.state,
    ast,
    null,
    false,
    (node, decls, error) => {
      if (node.loc && !error && decls.length) {
        const result: HoverItem = {
          node,
          decls: decls.flatMap((lookupDef) => lookupDef.results),
        };
        const type = analysis.typeMap?.get(node);
        if (type) {
          result.type = type;
        }
        results.push(result);
      }
      return undefined;
    },
    true,
    (node) => {
      if (skipToPosition(node, position, fileName)) {
        if (node.type === "CallExpression") {
          results.push({ node, decls: [] });
        }
        return true;
      }
      return false;
    },
    analysis.typeMap,
    true
  );

  while (true) {
    const result = results.pop();
    if (!result) return null;
    if (result.decls.length) {
      return [result, results.pop()];
    }
  }
}