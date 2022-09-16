import assert from "assert";
import type ts from "typescript";
import { getDecorators } from "../util/functions/getDecorators";
import { createDiagnosticAtLocation } from "../util/functions/createDiagnosticAtLocation";
import { Provider } from "../util/provider";

export function getSemanticDiagnosticsFactory(provider: Provider): ts.LanguageService["getSemanticDiagnostics"] {
	const { service, ts } = provider;

	function formatType(type: ts.Type) {
		const typeNode = type.checker.typeToTypeNode(
			type,
			undefined,
			ts.NodeBuilderFlags.InTypeAlias | ts.NodeBuilderFlags.IgnoreErrors,
		);
		assert(typeNode);

		const printer = ts.createPrinter();
		return printer.printNode(ts.EmitHint.Unspecified, typeNode, undefined as never);
	}

	function getAssignabilityDiagnostics(
		node: ts.Node,
		sourceType: ts.Type,
		constraintType: ts.Type,
		trace: ts.Node,
	): ts.DiagnosticWithLocation {
		const diagnostic = createDiagnosticAtLocation(
			node,
			`Type '${formatType(sourceType)}' does not satify constraint '${formatType(constraintType)}'`,
			ts.DiagnosticCategory.Error,
		);

		ts.addRelatedInfo(
			diagnostic,
			createDiagnosticAtLocation(trace, "The constraint is defined here.", ts.DiagnosticCategory.Message),
		);

		return diagnostic;
	}

	function getConstraints(node: ts.Node) {
		const constraints = new Array<[ts.Type, ts.Node]>();

		const tags = ts.getJSDocTags(node);
		for (const tag of tags) {
			if (tag.tagName.text === "metadata") {
				if (typeof tag.comment !== "string" && tag.comment) {
					for (const comment of tag.comment) {
						if (ts.isJSDocLinkLike(comment) && comment.text === "constraint" && comment.name) {
							const symbol = provider.getSymbol(comment.name);
							if (!symbol) continue;

							const type =
								symbol.flags & ts.SymbolFlags.TypeAlias
									? provider.typeChecker.getDeclaredTypeOfSymbol(symbol)
									: provider.typeChecker.getTypeAtLocation(comment.name);

							constraints.push([type, comment]);
						}
					}
				}
			}
		}

		const decorators = getDecorators(provider, node);
		if (decorators) {
			for (const decorator of decorators) {
				const expression = decorator.expression;
				const symbol = provider.getSymbol(ts.isCallExpression(expression) ? expression.expression : expression);
				if (!symbol || !symbol.declarations) continue;

				for (const declaration of symbol.declarations) {
					constraints.push(...getConstraints(declaration));
				}
			}
		}

		// Interfaces are able to request metadata for their own property/methods.
		if (ts.isClassElement(node) && node.name) {
			const name = ts.getNameFromPropertyName(node.name);
			if (name && ts.isClassLike(node.parent)) {
				const implementNodes = ts.getEffectiveImplementsTypeNodes(node.parent);
				if (implementNodes) {
					for (const implement of implementNodes) {
						const symbol = provider.getSymbol(implement.expression);
						const member = symbol?.members?.get(ts.escapeLeadingUnderscores(name));
						if (member && member.declarations) {
							for (const declaration of member.declarations) {
								constraints.push(...getConstraints(declaration));
							}
						}
					}
				}
			}
		}

		return constraints;
	}

	function checkConstraints(diagnostics: ts.Diagnostic[], node: ts.ClassDeclaration | ts.ClassElement) {
		const constraints = getConstraints(node);
		const sourceType = provider.typeChecker.getTypeAtLocation(node);
		for (const [constraintType, trace] of constraints) {
			if (!provider.typeChecker.isTypeAssignableTo(sourceType, constraintType)) {
				diagnostics.push(getAssignabilityDiagnostics(node.name ?? node, sourceType, constraintType, trace));
			}
		}
	}

	return (file) => {
		const diagnostics = service.getSemanticDiagnostics(file);
		const sourceFile = provider.getSourceFile(file);

		function visitor(node: ts.Node) {
			if (!ts.isClassDeclaration(node)) return;
			if (!node.decorators) return;

			checkConstraints(diagnostics, node);
			for (const element of node.members) {
				checkConstraints(diagnostics, element);
			}
		}

		ts.forEachChildRecursively(sourceFile, visitor);

		return diagnostics;
	};
}
