import type { BrowserContext, Page } from "playwright";
import { isExistingChromePageEligible } from "./existing-chrome-page-policy.js";

export type ExistingChromeDisconnect = () => Promise<void>;

export function createExistingChromeContextAdapter(
  context: BrowserContext,
  disconnect: ExistingChromeDisconnect,
): BrowserContext {
  const wrappedPages = new WeakMap<Page, Page>();
  let proxy: BrowserContext;

  const wrapPage = (page: Page): Page => {
    const existing = wrappedPages.get(page);
    if (existing !== undefined) return existing;

    const wrapped = new Proxy(page, {
      get(target, property) {
        if (property === "isClosed") {
          return () => target.isClosed() || !isExistingChromePageEligible(target.url());
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    wrappedPages.set(page, wrapped);
    return wrapped;
  };

  proxy = new Proxy(context, {
    get(target, property) {
      if (property === "pages") {
        return () => target.pages()
          .filter((page) => isExistingChromePageEligible(page.url()))
          .map(wrapPage);
      }
      if (property === "newPage") {
        return async () => wrapPage(await target.newPage());
      }
      if (property === "close") {
        return disconnect;
      }
      if (property === "on") {
        return (event: string, listener: (...args: unknown[]) => void) => {
          if (event === "page") {
            const announced = new WeakSet<Page>();
            const announce = (page: Page): void => {
              if (announced.has(page)) return;
              announced.add(page);
              listener(wrapPage(page));
            };
            target.on("page", (page) => {
              if (isExistingChromePageEligible(page.url())) {
                announce(page);
                return;
              }
              // A tab emitted as chrome://newtab becomes visible only once it navigates.
              const stopWatching = (): void => {
                page.off("framenavigated", onNavigated);
                page.off("close", stopWatching);
              };
              const onNavigated = (): void => {
                if (!isExistingChromePageEligible(page.url())) return;
                stopWatching();
                announce(page);
              };
              page.on("framenavigated", onNavigated);
              page.on("close", stopWatching);
            });
            return proxy;
          }
          const on = target.on as unknown as (event: string, listener: (...args: unknown[]) => void) => BrowserContext;
          on.call(target, event, listener);
          return proxy;
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return proxy;
}
