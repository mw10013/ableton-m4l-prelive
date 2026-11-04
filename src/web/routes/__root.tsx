import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useHydrated,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { DefaultCatchBoundary } from "#web/components/default-catch-boundary.tsx";
import { NotFound } from "#web/components/not-found.tsx";

import appCss from "#web/styles.css?url";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "prelive" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      ...(import.meta.env.DEV
        ? [{ rel: "stylesheet", href: "/virtual:stylex.css" }]
        : []),
    ],
  }),
  shellComponent: RootDocument,
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
});

function RootComponent() {
  const hydrated = useHydrated();
  return (
    <div inert={!hydrated} data-app-hydrated={hydrated ? "true" : undefined}>
      <Outlet />
    </div>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <Theme theme={neutralTheme} mode="dark">
          {children}
        </Theme>
        <Scripts />
      </body>
    </html>
  );
}
