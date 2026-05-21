import { createContext, useContext } from "react";
import type { Language } from "../types";
import { en } from "./en";
import { zh } from "./zh";

const dictionaries = { en, zh };
type DictionaryKey = keyof typeof en;

export type Translator = (key: DictionaryKey, params?: Record<string, string | number>) => string;

export function createTranslator(language: Language): Translator {
  const dictionary = (dictionaries[language] ?? dictionaries.zh) as Record<string, string>;
  const fallback = dictionaries.en as Record<string, string>;
  return (key, params) => {
    const template: string = dictionary[key] ?? fallback[key] ?? key;
    if (!params) return template;
    return Object.entries(params).reduce(
      (value, [paramKey, paramValue]) => value.split(`{${paramKey}}`).join(String(paramValue)),
      template,
    );
  };
}

const I18nContext = createContext<Translator>(createTranslator("zh"));

export const I18nProvider = I18nContext.Provider;

export function useI18n() {
  return useContext(I18nContext);
}
