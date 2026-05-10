import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const rootRoute = createRootRoute({
  component: RootLayout,
});

// eslint-disable-next-line react-refresh/only-export-components
function RootLayout() {
  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
            F
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">FinSight</h1>
            <p className="text-xs text-gray-500">Investment Analyst Copilot</p>
          </div>
        </div>
        <nav className="flex gap-1">
          <Link
            to="/"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 [&.active]:bg-blue-50 [&.active]:text-blue-700"
          >
            Research
          </Link>
          <Link
            to="/documents"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 [&.active]:bg-blue-50 [&.active]:text-blue-700"
          >
            Documents
          </Link>
          <Link
            to="/admin"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 [&.active]:bg-blue-50 [&.active]:text-blue-700"
          >
            Admin
          </Link>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
