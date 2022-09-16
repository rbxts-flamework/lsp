import type ts from "typescript";
import { isStaticLocation } from "../util/functions/isStaticLocation";
import { isInjectable } from "../util/functions/isInjectable";
import { Provider } from "../util/provider";
import { expect } from "../util/functions/expect";
import { getDecorators } from "../util/functions/getDecorators";

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

	function createNewConstructorBody(declaration: ts.ClassDeclaration, ctor: ts.ConstructorDeclaration) {
		const ctorOrder = provider.config.constructorOrder;
		const ctorNewLine = provider.config.constructorPadding;
		const startNewLine = ctorNewLine === "before" || ctorNewLine === "both" ? "\n" : "";
		const endNewLine = ctorNewLine === "after" || ctorNewLine === "both" ? "\n" : "";
		const ctorBody = provider
			.print(ctor, declaration.getSourceFile())
			.replace(/\n/g, "\n\t")
			.replace(") { }", ") {}");

		if (ctorOrder === "preFields" || ctorOrder === "preMethods") {
			const preMethods = provider.config.constructorOrder === "preMethods";
			const memberIndex = declaration.members.findIndex(
				(v) =>
					(preMethods ? ts.isMethodDeclaration(v) : ts.isPropertyDeclaration(v)) && !ts.hasStaticModifier(v),
			);
			const previousMember = declaration.members[memberIndex - 1];
			const nextMember = declaration.members[memberIndex];

			if (previousMember) {
				return {
					start: previousMember ? previousMember.getEnd() : declaration.members.pos,
					end: nextMember.getFullStart(),
					body: `\n${startNewLine}\t${ctorBody}`,
				};
			}
		}

		// Fallback / Top
		return { start: declaration.members.pos, body: `\n\t${ctorBody}${endNewLine}` };
	}

	function printParameters(file: ts.SourceFile, node: ts.ConstructorDeclaration, old: ts.ConstructorDeclaration) {
		const baseFlags = ts.ListFormat.Parameters & ~ts.ListFormat.Parenthesis;
		if (isMultiLine(file, old.parameters)) {
			return `\n\t\t${provider.printer
				.printList(baseFlags | ts.ListFormat.MultiLine, node.parameters, file)
				.trimEnd()
				.replace(/\n/g, "\n\t\t")},`;
		} else {
			return provider.printer.printList(baseFlags, node.parameters, file);
		}
	}

	function getImportChange(file: ts.SourceFile, importName: string, importPath: string): ts.TextChange | undefined {
		for (const statement of file.statements) {
			if (
				ts.isImportDeclaration(statement) &&
				statement.importClause &&
				statement.importClause.namedBindings &&
				ts.isNamedImports(statement.importClause.namedBindings) &&
				(statement.moduleSpecifier as ts.StringLiteral).text === importPath
			) {
				const clause = statement.importClause;
				const bindings = statement.importClause.namedBindings;
				for (const element of bindings.elements) {
					if (element.name.text === importName) {
						return;
					}
				}

				const newImport = ts.factory.updateImportDeclaration(
					statement,
					statement.decorators,
					statement.modifiers,
					ts.factory.updateImportClause(
						clause,
						false,
						clause.name,
						ts.factory.updateNamedImports(bindings, [
							...bindings.elements,
							ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(importName)),
						]),
					),
					statement.moduleSpecifier,
					statement.assertClause,
				);
				return {
					span: ts.createTextSpanFromNode(statement, file),
					newText: provider.print(newImport, file),
				};
			}
		}

		let newImportPosition = 0;
		for (const statement of file.statements) {
			if (ts.isImportDeclaration(statement)) {
				newImportPosition = statement.getEnd();
			} else {
				break;
			}
		}

		const newImport = ts.factory.createImportDeclaration(
			undefined,
			undefined,
			ts.factory.createImportClause(
				false,
				undefined,
				ts.factory.createNamedImports([
					ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(importName)),
				]),
			),
			ts.factory.createStringLiteral(importPath),
		);
		return {
			span: ts.createTextSpan(newImportPosition, 0),
			newText: "\n" + provider.print(newImport, file),
		};
	}

	function isFlameworkDecorated(declaration: ts.ClassDeclaration) {
		const decorators = getDecorators(declaration);
		if (decorators) {
			for (const decorator of decorators) {
				const type = provider.typeChecker.getTypeAtLocation(decorator.expression);
				if (type && type.getProperty("_flamework_Decorator") !== undefined) {
					return true;
				}

				// Pre-modding release does not have _flamework_Decorator, temporary workaround.
				if (ts.isCallExpression(decorator.expression)) {
					const symbol = provider.getSymbol(decorator.expression.expression);
					if (symbol?.name === "Service" || symbol?.name === "Controller" || symbol?.name === "Component") {
						return true;
					}
				}
			}
		}
		return false;
	}

	function getParentClass(declaration: ts.ClassDeclaration) {
		const extendsClause = ts.getHeritageClause(declaration.heritageClauses, ts.SyntaxKind.ExtendsKeyword);
		if (!extendsClause) return;

		const node = extendsClause.types[0];
		const symbol = provider.getSymbol(node.expression);
		if (!symbol) return;
		if (!symbol.valueDeclaration) return;
		if (!ts.isClassDeclaration(symbol.valueDeclaration)) return;

		return symbol.valueDeclaration;
	}

	function getParentParameters(declaration: ts.ClassDeclaration) {
		let current = getParentClass(declaration);
		while (current) {
			const constructor = current.members.find(ts.isConstructorDeclaration);
			if (constructor) {
				return constructor.parameters;
			}
			current = getParentClass(current);
		}
	}

	function getBestFix(specifiers: readonly string[]) {
		return specifiers.reduce((best, fix) =>
			ts.compareNumberOfDirectorySeparators(best, fix) === ts.Comparison.LessThan ? fix : best,
		);
	}

	function convertParameter(
		file: ts.SourceFile,
		parameter: ts.ParameterDeclaration,
		host: ts.ModuleSpecifierResolutionHost,
		userPreferences: ts.UserPreferences,
	) {
		if (ts.isIdentifier(parameter.name) && parameter.type) {
			const symbol = provider.getSymbol(parameter.type);
			const symbolDeclaration = symbol?.valueDeclaration;
			if (symbolDeclaration) {
				const moduleSymbol = expect(provider.getSymbol(symbolDeclaration.getSourceFile()));
				const specifiers = ts.moduleSpecifiers.getModuleSpecifiers(
					moduleSymbol,
					provider.typeChecker,
					provider.constants.compilerOptions,
					file,
					host,
					userPreferences,
				);
				return {
					change: getImportChange(file, symbol.name, getBestFix(specifiers)),
					name: parameter.name,
					parameter: ts.factory.updateParameterDeclaration(
						parameter,
						undefined,
						undefined,
						undefined,
						parameter.name,
						parameter.questionToken,
						parameter.type,
						undefined,
					),
				};
			}
		}
	}

	function createChange(
		file: ts.SourceFile,
		entry: string,
		declaration: ts.ClassDeclaration,
		preferences: ts.UserPreferences,
	): ts.CodeAction {
		const changes = new Array<ts.FileTextChanges>();
		const modifiers = new Array<ts.Modifier>();
		const modifierConfig = (provider.config.accessibility ?? "private-readonly").split("-");
		for (const token of modifierConfig) {
			modifiers.push(tokens[token as keyof typeof tokens]);
		}

		if (isFlameworkDecorated(declaration) && !provider.config.alwaysUsePropertyDI) {
			// This class is using a Flamework decorator, so it probably has constructor DI.
			let ctor = declaration.members.find(ts.isConstructorDeclaration);
			if (!ctor) {
				const parentParameters = getParentParameters(declaration);
				const statements = new Array<ts.Statement>();
				const parameters = new Array<ts.ParameterDeclaration>();
				const superIdentifiers = new Array<ts.Identifier>();
				if (parentParameters) {
					const host = ts.createModuleSpecifierResolutionHost(
						provider.program,
						provider.info.languageServiceHost,
					);
					for (const parameter of parentParameters) {
						const result = convertParameter(file, parameter, host, preferences);
						if (result) {
							if (result.change) {
								changes.push({
									fileName: file.fileName,
									textChanges: [result.change],
								});
							}
							parameters.push(result.parameter);
							superIdentifiers.push(result.name);
						} else {
							superIdentifiers.push(ts.factory.createIdentifier("undefined"));
						}
					}
				}

				if (superIdentifiers.length > 0 || getParentClass(declaration)) {
					statements.push(
						ts.factory.createExpressionStatement(
							ts.factory.createCallExpression(ts.factory.createSuper(), undefined, superIdentifiers),
						),
					);
				}

				ctor = ts.factory.createConstructorDeclaration(
					undefined,
					undefined,
					parameters,
					ts.factory.createBlock(statements, statements.length > 0),
				);
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
				const { start, end, body } = createNewConstructorBody(declaration, newCtor);
				changes.push({
					fileName: file.fileName,
					textChanges: [ts.createTextChange(ts.createTextSpanFromBounds(start, end ?? start), body)],
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
		} else {
			// This class isn't using a Flamework decorator, so it should use the Dependency<T> macro.
			const addImportChange = getImportChange(file, "Dependency", "@flamework/core");
			if (addImportChange) {
				changes.push({
					fileName: file.fileName,
					textChanges: [addImportChange],
				});
			}

			// Attempts to group dependencies next to properties of the same visibility.
			let newlineEnd = false;
			let start: number | undefined;
			for (const member of declaration.members) {
				if (
					ts.isPropertyDeclaration(member) &&
					ts.hasSyntacticModifier(member, ts.modifierToFlag(modifiers[0].kind))
				) {
					const ranges = ts.getLeadingCommentRangesOfNode(member, member.getSourceFile());
					newlineEnd = ranges ? ranges.length > 0 : false;
					start = member.getEnd() - member.getFullText().trimStart().length;
					break;
				}
			}

			if (start === undefined) {
				const member = declaration.members.find((member) => !ts.hasStaticModifier(member));
				if (member) {
					const ranges = ts.getLeadingCommentRangesOfNode(member, member.getSourceFile());
					newlineEnd = ranges ? ranges.length > 0 : false;
					start = member.getEnd() - member?.getFullText().trimStart().length;
				}
			}

			const newProperty = ts.factory.createPropertyDeclaration(
				undefined,
				modifiers,
				provider.convertCase(entry),
				undefined,
				undefined,
				ts.factory.createCallExpression(
					ts.factory.createIdentifier("Dependency"),
					[ts.factory.createTypeReferenceNode(entry)],
					undefined,
				),
			);
			changes.push({
				fileName: file.fileName,
				textChanges: [
					{
						span: ts.createTextSpan(start ?? declaration.members.pos, 0),
						newText: `${start ? "" : "\n\t"}${provider.print(newProperty, file)}${
							start ? (newlineEnd ? "\n\n\t" : "\n\t") : ""
						}`,
					},
				],
			});
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
			if (
				token !== undefined &&
				ts.isIdentifier(token) &&
				ts.isInExpressionContext(token) &&
				!isStaticLocation(token)
			) {
				const declaration = ts.findAncestor(token, ts.isClassDeclaration);
				if (declaration && isInjectable(provider, token, entry, data)) {
					result.codeActions ??= [];
					result.codeActions.push(createChange(sourceFile, entry, declaration, preferences ?? {}));
				}
			}
		}
		if (result && result.tags) {
			result.tags = result.tags.filter((v) => v.name !== "metadata");
		}
		return result;
	};
}
