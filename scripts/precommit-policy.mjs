import ts from "typescript";
import path from "node:path";

/** Identify executable repository code, including tooling but excluding tests and declarations. */
export function isRuntimeSource(file) {
  return (
    /\.[cm]?[jt]sx?$/.test(file) &&
    !/\.d\.[cm]?ts$/.test(file) &&
    !/(?:^|\/)(?:tests?|__tests__|node_modules|dist|coverage|\.git)(?:\/|$)/.test(
      file,
    ) &&
    !/\.(?:test|spec)\.[^.]+$/.test(file) &&
    ![
      "eslint.config.mjs",
      "playwright.config.ts",
      "frontend/vite.config.ts",
      "backend/tsup.config.ts",
    ].includes(file)
  );
}

/** Distinguish executable TypeScript from erased interfaces and type-only modules. */
export function hasRuntimeCode(file, source) {
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      experimentalDecorators: true,
      removeComments: true,
    },
  });
  return outputText.replace(/export\s*\{\s*\};?/g, "").trim().length > 0;
}

/** Return declarations that need meaningful JSDoc; inline callbacks inherit their enclosing API's documentation. */
export function missingJsdoc(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const failures = [];
  /** Visit named declarations and function-valued variables/properties. */
  function visit(node) {
    const declaration =
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ((ts.isVariableDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isPropertyAssignment(node)) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) ||
          ts.isFunctionExpression(node.initializer)));
    if (declaration) {
      let owner = node;
      if (ts.isVariableDeclaration(node)) owner = node.parent.parent;
      let docs = ts.getJSDocCommentsAndTags(owner).filter(ts.isJSDoc);
      // TS does not attach same-line object-property comments; parse that trivia
      // before a synthetic declaration to preserve valid inline JSDoc.
      if (!docs.length) {
        const trivia = source.slice(owner.pos, owner.getStart(tree));
        const documented = ts.createSourceFile(
          "doc.ts",
          `${trivia}\nfunction documented() {}`,
          ts.ScriptTarget.Latest,
          true,
        );
        docs = ts
          .getJSDocCommentsAndTags(documented.statements[0])
          .filter(ts.isJSDoc);
      }
      if (
        !docs.some(
          (doc) =>
            typeof doc.comment === "string" && doc.comment.trim().length > 0,
        )
      ) {
        const line =
          tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
        failures.push(
          `${file}:${line}: meaningful JSDoc required for ${node.name?.getText(tree) ?? "constructor/default declaration"}`,
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return failures;
}

/** Require strictly greater than 90% for each metric of every changed executable file. */
export function coverageFailures(files, summary, root) {
  const failures = [];
  for (const file of files) {
    const metrics = summary[path.resolve(root, file)];
    if (!metrics) {
      failures.push(
        `${file}: missing coverage (unexecuted files must not pass)`,
      );
      continue;
    }
    for (const metric of ["lines", "statements", "functions", "branches"]) {
      const value = metrics[metric];
      // Compare counts rather than rounded display percentages; exactly 90% fails.
      if (!value || (value.total > 0 && value.covered / value.total <= 0.9)) {
        failures.push(
          `${file}: ${metric} coverage ${value?.pct ?? "missing"}% must be >90%`,
        );
      }
    }
  }
  return failures;
}
