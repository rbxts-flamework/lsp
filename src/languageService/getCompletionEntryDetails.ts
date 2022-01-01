import type ts from "typescript";
import { isInjectable } from "../util/functions/isInjectable";
import { Provider } from "../util/provider";

const NO_WHITESPACE = /\S/;

export function getCompletionEntryDetailsFactory(provider: Provider): ts.LanguageService["getCompletionEntryDetails"] {
	const { service, ts } = provider;
	const tokens = {
		public: ts.factory.createToken(ts.SyntaxKind.PublicKeyword),
		private: ts.factory.createToken(ts.SyntaxKind.PrivateKeyword),
		protected: ts.factory.createToken(ts.SyntaxKind.ProtectedKeyword),
		readonly: ts.factory.createToken(ts.SyntaxKind.ReadonlyKeyword),
	} as const;

	function isMultiLine(file: ts.SourceFile, range: ts.TextRange) {
		return ts.getLineOfLocalPosition(file, range.pos) !== ts.getLineOfLocalPosition(file, range.end);
	}

	function isEmptyLine(file: ts.SourceFile, pos: number, offset: number) {
		const line = ts.getLineOfLocalPosition(file, pos) + offset;
		const startOfLine = ts.getStartPositionOfLine(line, file);
		const endOfLine = ts.getEndLinePosition(line, file);
		return !NO_WHITESPACE.test(file.text.substring(startOfLine, endOfLine));
	}

	function createNewConstructorBody(
		declaration: ts.ClassDeclaration,
		ctor: ts.ConstructorDeclaration,
		file: ts.SourceFile,
	) {
		const ctorOrder = provider.config.constructorOrder;
		const ctorNewLine = provider.config.constructorPadding;
		const startNewLine = ctorNewLine === "before" || ctorNewLine === "both" ? "\n" : "";
		const endNewLine = ctorNewLine === "after" || ctorNewLine === "both" ? "\n" : "";
		const ctorBody = ts
			.createPrinter()
			.printNode(ts.EmitHint.Unspecified, ctor, file)
			.replace(/\n/g, "\n\t")
			.replace(") { }", ") {}");

		if (ctorOrder === "preFields" || ctorOrder === "preMethods") {
			const preMethods = provider.config.constructorOrder === "preMethods";

			let maxIndex = declaration.members.length - 1;
			for (const [i, v] of declaration.members.entries()) {
				if (
					(preMethods ? ts.isMethodDeclaration(v) : ts.isPropertyDeclaration(v)) &&
					!ts.hasStaticModifier(v)
				) {
					maxIndex = i;
					break;
				}
			}

			const start = declaration.members[maxIndex].getFullStart();
			const startNewLineOptional = isEmptyLine(file, start, 0) || maxIndex === 0 ? "" : startNewLine;
			const endNewLineOptional = isEmptyLine(file, start, 1) ? "" : endNewLine;

			return { start, body: `\n${startNewLineOptional}\t${ctorBody}${endNewLineOptional}` };
		}

		// Fallback / Top
		return { start: declaration.members.pos, body: `\n\t${ctorBody}${endNewLine}` };
	}

	function printParameters(file: ts.SourceFile, node: ts.ConstructorDeclaration, old: ts.ConstructorDeclaration) {
		const baseFlags = ts.ListFormat.Parameters & ~ts.ListFormat.Parenthesis;
		const printer = ts.createPrinter();
		if (isMultiLine(file, old.parameters)) {
			return `\n\t\t${printer
				.printList(baseFlags | ts.ListFormat.MultiLine, node.parameters, file)
				.trimEnd()
				.replace(/\n/g, "\n\t\t")},`;
		} else {
			return printer.printList(baseFlags, node.parameters, file);
		}
	}

	function createChange(file: ts.SourceFile, entry: string, declaration: ts.ClassDeclaration): ts.CodeAction {
		const changes = new Array<ts.FileTextChanges>();

		let ctor = declaration.members.find(ts.isConstructorDeclaration);
		if (!ctor) {
			ctor = ts.factory.createConstructorDeclaration(undefined, undefined, [], ts.factory.createBlock([], false));
		}

		if (
			!ctor.parameters.some(
				(v) => v.type && ts.isTypeReferenceNode(v.type) && v.type.typeName.getText() === entry,
			)
		) {
			const modifiers = new Array<ts.Modifier>();
			const modifierConfig = (provider.config.accessibility ?? "private-readonly").split("-");
			for (const token of modifierConfig) {
				modifiers.push(tokens[token as keyof typeof tokens]);
			}

			const newCtor = ts.factory.updateConstructorDeclaration(
				ctor,
				ctor.decorators,
				ctor.modifiers,
				[
					...ctor.parameters,
					ts.factory.createParameterDeclaration(
						undefined,
						modifiers,
						undefined,
						provider.convertCase(entry),
						undefined,
						ts.factory.createTypeReferenceNode(entry),
					),
				],
				ctor.body,
			);

			if (ctor.flags & ts.NodeFlags.Synthesized) {
				const { start, body } = createNewConstructorBody(declaration, newCtor, file);
				changes.push({
					fileName: file.fileName,
					textChanges: [ts.createTextChange(ts.createTextSpan(start, 0), body)],
				});
			} else {
				changes.push({
					fileName: file.fileName,
					textChanges: [
						ts.createTextChange(
							ts.createTextSpanFromRange(ctor.parameters),
							printParameters(file, newCtor, ctor),
						),
					],
				});
			}
		}

		return {
			description: "Use this class as a dependency.",
			changes,
		};
	}

	return (file, pos, entry, formatOptions, source, preferences, data) => {
		const result = service.getCompletionEntryDetails(file, pos, entry, formatOptions, source, preferences, data);
		const sourceFile = provider.program.getSourceFile(file);
		if (sourceFile && result && source !== ts.Completions.CompletionSource.ThisProperty) {
			const token = ts.findPrecedingToken(pos, sourceFile);
			if (token !== undefined && ts.isIdentifier(token) && ts.isExpressionStatement(token.parent)) {
				const declaration = ts.findAncestor(token, ts.isClassDeclaration);
				if (declaration && isInjectable(provider, token, entry, data)) {
					result.codeActions ??= [];
					result.codeActions.push(createChange(sourceFile, entry, declaration));
				}
			}
		}
		if (result && result.tags) {
			result.tags = result.tags.filter((v) => v.name !== "metadata");
		}
		return result;
	};
}
