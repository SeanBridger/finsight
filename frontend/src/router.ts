import { createRoute, createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/__root";
import { ChatPage } from "./pages/ChatPage";
import { DocumentsPage } from "./pages/DocumentsPage";

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ChatPage,
});

const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents",
  component: DocumentsPage,
});

const routeTree = rootRoute.addChildren([indexRoute, documentsRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
