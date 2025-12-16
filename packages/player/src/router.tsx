import {
	createBrowserRouter,
	createRoutesFromElements,
	Route,
} from "react-router-dom";
import ErrorPage from "./pages/error/index.tsx";

export const router = createBrowserRouter(
	createRoutesFromElements(
		<>
			<Route
				path="/"
				lazy={() => import("./pages/main/index.tsx")}
				errorElement={<ErrorPage />}
			/>
			<Route
				path="/settings"
				lazy={() => import("./pages/settings/index.tsx")}
				errorElement={<ErrorPage />}
			/>
			<Route
				path="/search"
				lazy={() => import("./pages/search/index.tsx")}
				errorElement={<ErrorPage />}
			/>
			<Route
				path="/playlist/:id"
				lazy={() => import("./pages/playlist")}
				errorElement={<ErrorPage />}
			/>
			<Route
				path="/song/:id"
				lazy={() => import("./pages/song/index.tsx")}
				errorElement={<ErrorPage />}
			/>
			<Route
				path="/amll-dev/mg-edit"
				lazy={() => import("./pages/amll-dev/mg-edit.tsx")}
				errorElement={<ErrorPage />}
			/>
			<Route
				path="/amll-dev"
				lazy={() => import("./pages/amll-dev/index.tsx")}
				errorElement={<ErrorPage />}
			/>
		</>,
	),
);
