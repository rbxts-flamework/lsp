import type ts from "typescript";
import { Provider } from "util/provider";

export function getQuickInfoAtPositionFactory(provider: Provider): ts.LanguageService["getQuickInfoAtPosition"] {
	const { service } = provider;

	return (fileName, position) => {
		const result = service.getQuickInfoAtPosition(fileName, position);
		if (result?.tags) {
			result.tags = result.tags.filter((x) => x.name !== "metadata");
		}
		return result;
	};
}
