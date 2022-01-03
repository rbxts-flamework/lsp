import type ts from "typescript";
import { isStaticLocation } from "../util/functions/isStaticLocation";
import { isInjectable } from "../util/functions/isInjectable";
import { Provider } from "../util/provider";

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

	return (file, pos, opt) => {
		const orig = service.getCompletionsAtPosition(file, pos, opt);
		const sourceFile = provider.program.getSourceFile(file);
		if (orig && sourceFile) {
			const token = ts.findPrecedingToken(pos, sourceFile);
			if (
				token !== undefined &&
				ts.isIdentifier(token) &&
				ts.isInExpressionContext(token) &&
				ts.findAncestor(token, ts.isClassDeclaration) !== undefined &&
				!isStaticLocation(token)
			) {
				const entries = new Array<ts.CompletionEntry>();
				orig.entries.forEach((entry) => {
					if (isInjectable(provider, token, entry.name, entry.data)) {
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
		}
		return orig;
	};
}
