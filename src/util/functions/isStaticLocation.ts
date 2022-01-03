import type ts from "typescript";
import { Provider } from "../provider";

export function isStaticLocation(token: ts.Node) {
	const { ts } = Provider;
	return (
		ts.forEachAncestor(token, (node) => {
			if (ts.isStatic(node)) {
				return true;
			} else if (ts.isClassLike(node)) {
				return "quit";
			}
		}) || false
	);
}
