import type ts from "typescript";
import { isStaticLocation } from "../util/functions/isStaticLocation";
import { isInjectable, isInjector } from "../util/functions/isInjectable";
import { Provider } from "../util/provider";
import { attachSymbol } from "../util/constants";

/**
 * Create the getCompletionsAtPosition method.
 */
export function getCompletionsAtPositionFactory(provider: Provider): ts.LanguageService["getCompletionsAtPosition"] {
	const { service, ts } = provider;

	function isThisCompletionFor(entry: ts.CompletionEntry, source: ts.CompletionEntry) {
		if (entry.name !== provider.convertCase(source.name)) {
			return false;
		}

		if (entry.source !== ts.Completions.CompletionSource.ThisProperty) {
			return false;
		}

		return entry !== source;
	}

	function isContextuallySensitive(token: ts.Node, declaration?: ts.ClassDeclaration) {
		if (ts.isIdentifier(token)) {
			token = token.parent;
		}

		if (declaration && ts.isParameter(token.parent) && isInjector(provider, declaration)) {
			return true;
		}

		if (
			(ts.isCallExpression(token.parent) || ts.isExpressionWithTypeArguments(token.parent)) &&
			token.parent.expression.getText() === "Dependency"
		) {
			return true;
		}

		return false;
	}

	return (file, pos, opt) => {
		const orig = service.getCompletionsAtPosition(file, pos, opt);
		const sourceFile = provider.program.getSourceFile(file);
		if (!attachSymbol(orig)) {
			return orig;
		}

		if (orig && sourceFile) {
			const token = ts.findPrecedingToken(pos, sourceFile);
			const declaration = ts.findAncestor(token, ts.isClassDeclaration);
			if (!token) return orig;

			if (
				declaration &&
				ts.isIdentifier(token) &&
				ts.isInExpressionContext(token) &&
				!isStaticLocation(token) &&
				isInjector(provider, declaration) &&
				!ts.isPossiblyTypeArgumentPosition(token, sourceFile, provider.typeChecker)
			) {
				const entries = new Array<ts.CompletionEntry>();
				orig.entries.forEach((entry) => {
					if (isInjectable(provider, entry.name, token, entry.data)) {
						if (orig.entries.some((v) => isThisCompletionFor(v, entry))) {
							return;
						} else {
							entry.insertText = `this.${provider.convertCase(entry.name)}`;
						}
					}
					entries.push(entry);
				});
				orig.entries = entries;
			}

			if (provider.config.smarterIntellisense && isContextuallySensitive(token, declaration)) {
				const entries = new Array<ts.CompletionEntry>();
				orig.entries.forEach((entry) => {
					if (isInjectable(provider, entry.name, undefined, entry.data)) {
						entries.push(entry);
					}
				});
				orig.entries = entries;
			}
		}
		return orig;
	};
}
