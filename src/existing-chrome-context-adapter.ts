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
            target.on("page", (page) => {
              if (isExistingChromePageEligible(page.url())) listener(wrapPage(page));
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
