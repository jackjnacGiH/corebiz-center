import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LanguageContext, translations, type Language } from './i18n';

const STORAGE_KEY = 'corebiz-language';

function getInitialLanguage(): Language {
  if (typeof window === 'undefined') {
    return 'th';
  }

  const storedLanguage = window.localStorage.getItem(STORAGE_KEY);
  return storedLanguage === 'th' || storedLanguage === 'en' ? storedLanguage : 'th';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: translations[language],
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
