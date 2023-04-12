// https://github.com/rbxts-flamework/transformer/blob/229fc50c22d856079ba031e13e0c43900b2fd7d7/src/classes/nodeMetadata.ts

import type ts from "typescript";
import { Provider } from "./provider";

export class NodeMetadata {
	private set = new Set<string>();
	private symbols = new Map<string, Array<ts.Symbol>>();
	private types = new Map<string, Array<ts.Type>>();
	private trace = new Map<string | ts.Symbol | ts.Type, ts.Node>();

	private parseText(text: string, node: ts.Node) {
		for (const name of text.trim().replace(/\s+/, " ").split(" ")) {
			this.set.add(name);
			this.trace.set(name, node);
		}
	}

	private parseMetadata(provider: Provider, tag: ts.JSDocTag) {
		const { ts } = provider;

		if (typeof tag.comment === "string") {
			this.parseText(tag.comment, tag);
		} else if (tag.comment) {
			for (const comment of tag.comment) {
				if (ts.isJSDocLinkLike(comment)) {
					if (!comment.name) continue;

					const symbol = provider.getSymbol(comment.name);
					if (!symbol) continue;

					const type =
						symbol.flags & ts.SymbolFlags.TypeAlias
							? provider.typeChecker.getDeclaredTypeOfSymbol(symbol)
							: provider.typeChecker.getTypeAtLocation(comment.name);

					let symbols = this.symbols.get(comment.text);
					let types = this.types.get(comment.text);
					if (!types) this.types.set(comment.text, (types = []));
					if (!symbols) this.symbols.set(comment.text, (symbols = []));

					symbols.push(symbol);
					types.push(type);
					this.trace.set(symbol, comment);
					this.trace.set(type, comment);
				} else {
					this.parseText(comment.text, comment);
				}
			}
		}
	}

	private parse(provider: Provider, node: ts.Node) {
		const { ts } = provider;

		const tags = ts.getJSDocTags(node);
		for (const tag of tags) {
			if (tag.tagName.text === "metadata") {
				this.parseMetadata(provider, tag);
			}
		}

		const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
		if (decorators) {
			for (const decorator of decorators) {
				const expression = decorator.expression;
				const symbol = provider.getSymbol(ts.isCallExpression(expression) ? expression.expression : expression);
				if (!symbol || !symbol.declarations) continue;

				for (const declaration of symbol.declarations) {
					this.parse(provider, declaration);
				}
			}
		}

		if (ts.isClassElement(node) && node.name) {
			// Interfaces are able to request metadata for their own property/methods.
			const name = ts.getNameFromPropertyName(node.name);
			if (name && ts.isClassLike(node.parent)) {
				const implementNodes = ts.getEffectiveImplementsTypeNodes(node.parent);
				if (implementNodes) {
					for (const implement of implementNodes) {
						const symbol = provider.getSymbol(implement.expression);
						const member = symbol?.members?.get(ts.escapeLeadingUnderscores(name));
						if (member && member.declarations) {
							for (const declaration of member.declarations) {
								this.parse(provider, declaration);
							}
						}
					}
				}
			}
		} else if (ts.isClassLike(node)) {
			// Interfaces are able to request metadata for the object it is implemented on.
			const implementNodes = ts.getEffectiveImplementsTypeNodes(node);
			if (implementNodes) {
				for (const implement of implementNodes) {
					const symbol = provider.getSymbol(implement.expression);
					if (symbol && symbol.declarations?.[0]) {
						this.parse(provider, symbol.declarations[0]);
					}
				}
			}
		}
	}

	constructor(provider: Provider, node: ts.Node) {
		this.parse(provider, node);
	}

	isRequested(metadata: string) {
		if (this.set.has(`~${metadata}`)) {
			return false;
		}

		return this.set.has(metadata) || this.set.has("*");
	}

	getSymbol(key: string) {
		return this.symbols.get(key);
	}

	getType(key: string) {
		return this.types.get(key);
	}

	getTrace(name: string | ts.Symbol | ts.Type) {
		return this.trace.get(name);
	}
}
