import { Navigate, Route, Routes } from "react-router-dom";


// import { AppShell } from "./AppShell";
import { AppShell } from "../components/AppShell";
import { Protected } from "./Protected";

import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";

import { DashboardPage } from "../pages/DashboardPage";
import { PropertiesPage } from "../pages/PropertiesPage";
import { PropertyDetailPage } from "../pages/PropertyDetailPage";
import { PropertyFormPage } from "../pages/PropertyFormPage";
import { CalendarPage } from "../pages/CalendarPage";
import { MyPropertiesPage } from "../pages/MyPropertiesPage";

import {
  UsersPage,
  MasterDataPage,
} from "../pages/AdminPages";

import {
  TenantsPage,
  SecurityPage,
} from "../pages/PlatformPages";


export function AppRouter() {
  return (
    <Routes>

      {/* =========================
          PUBLIC ROUTES
      ========================= */}

      <Route
        path="/login"
        element={<LoginPage />}
      />

      <Route
        path="/register"
        element={<RegisterPage />}
      />


      {/* =========================
          ERROR ROUTES
      ========================= */}

      <Route
        path="/403"
        element={
          <div style={{ padding: 40 }}>
            <h1>403</h1>
            <p>
              You do not have permission to access this page.
            </p>
          </div>
        }
      />

      <Route
        path="/404"
        element={
          <div style={{ padding: 40 }}>
            <h1>404</h1>
            <p>
              The page you are looking for does not exist.
            </p>
          </div>
        }
      />


      {/* =========================
          PROTECTED APP
      ========================= */}

      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >

        {/* Default */}
        <Route
          index
          element={
            <Navigate
              to="/dashboard"
              replace
            />
          }
        />


        {/* =========================
            DASHBOARD
        ========================= */}

        <Route
          path="dashboard"
          element={
            <Protected
              roles={["ADMIN", "MANAGER"]}
            >
              <DashboardPage />
            </Protected>
          }
        />


        {/* =========================
            PROPERTIES
        ========================= */}

        <Route
          path="properties"
          element={
            <PropertiesPage />
          }
        />

        <Route
          path="properties/new"
          element={
            <Protected
              roles={[
                "ADMIN",
                "MANAGER",
                "AGENT",
              ]}
            >
              <PropertyFormPage />
            </Protected>
          }
        />

        <Route
          path="properties/:id"
          element={
            <PropertyDetailPage />
          }
        />


        {/* =========================
            AGENT MY PROPERTIES
        ========================= */}

        <Route
          path="my-properties"
          element={
            <Protected roles={["AGENT"]}>
              <MyPropertiesPage />
            </Protected>
          }
        />


        {/* =========================
            CALENDAR
        ========================= */}

        <Route
          path="calendar"
          element={
            <CalendarPage />
          }
        />


        {/* =========================
            ADMIN
        ========================= */}

        <Route
          path="admin/users"
          element={
            <Protected roles={["ADMIN"]}>
              <UsersPage />
            </Protected>
          }
        />

        <Route
          path="admin/master-data"
          element={
            <Protected roles={["ADMIN"]}>
              <MasterDataPage />
            </Protected>
          }
        />


        {/* =========================
            SUPER ADMIN
        ========================= */}

        <Route
          path="platform/tenants"
          element={
            <Protected
              roles={["SUPER_ADMIN"]}
            >
              <TenantsPage />
            </Protected>
          }
        />

        <Route
          path="platform/security"
          element={
            <Protected
              roles={["SUPER_ADMIN"]}
            >
              <SecurityPage />
            </Protected>
          }
        />

      </Route>


      {/* =========================
          UNKNOWN ROUTE
      ========================= */}

      <Route
        path="*"
        element={
          <Navigate
            to="/404"
            replace
          />
        }
      />

    </Routes>
  );
}