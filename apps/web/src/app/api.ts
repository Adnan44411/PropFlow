import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { RootState } from "./store";
import { logout, setSession } from "./store";

const CRM =
  import.meta.env.VITE_CRM_API_URL || "http://localhost:5001";

const AUTH =
  import.meta.env.VITE_AUTH_API_URL || "http://localhost:4000";

const raw = fetchBaseQuery({
  baseUrl: CRM,
  credentials: "include",
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.accessToken;

    if (token && token !== "demo-token") {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return headers;
  },
});

let refreshPromise: Promise<string | null> | null = null;

const refreshAccessToken = async (
  api: Parameters<typeof raw>[1]
): Promise<string | null> => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const result = await fetch(`${AUTH}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!result.ok) {
        return null;
      }

      const data = await result.json();
      const accessToken = data?.accessToken;

      if (!accessToken) {
        return null;
      }

      const state = api.getState() as RootState;

      if (state.auth.user) {
        api.dispatch(
          setSession({
            user: state.auth.user,
            accessToken,
            demo: false,
          })
        );
      }

      return accessToken;
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
};

export const api = createApi({
  reducerPath: "api",

  baseQuery: async (args, api, extra) => {
    let result = await raw(args, api, extra);

    const state = api.getState() as RootState;

    if (state.auth.demo) {
      return { data: undefined };
    }

    if (result.error?.status === 401) {
      const accessToken = await refreshAccessToken(api);

      if (accessToken) {
        result = await raw(args, api, extra);
      } else {
        api.dispatch(logout());
      }
    }

    return result;
  },

  tagTypes: [
    "Properties",
    "Visits",
    "Dashboard",
    "Users",
    "MasterData",
  ],

  endpoints: (b) => ({
    // =========================
    // PROPERTIES
    // =========================

    properties: b.query<
      any,
      {
        params?: Record<string, unknown>;
      }
    >({
      query: ({ params = {} } = {}) => ({
        url: "/properties",
        params,
      }),

      providesTags: ["Properties"],
    }),

    property: b.query<any, number>({
      query: (id) => `/properties/${id}`,

      providesTags: (_result, _error, id) => [
        {
          type: "Properties",
          id,
        },
      ],
    }),

    createProperty: b.mutation<any, any>({
      query: (body) => ({
        url: "/properties",
        method: "POST",
        body,
      }),

      invalidatesTags: ["Properties", "Dashboard"],
    }),

    updateProperty: b.mutation<
      any,
      {
        id: number;
        body: any;
      }
    >({
      query: ({ id, body }) => ({
        url: `/properties/${id}`,
        method: "PATCH",
        body,
      }),

      invalidatesTags: ["Properties", "Dashboard"],
    }),

    bulkProperties: b.mutation<any, any>({
      query: (body) => ({
        url: "/properties/bulk",
        method: "POST",
        body,
      }),

      invalidatesTags: ["Properties", "Dashboard"],
    }),

    deleteProperty: b.mutation<void, number>({
      query: (id) => ({
        url: `/properties/${id}`,
        method: "DELETE",
      }),

      invalidatesTags: ["Properties", "Dashboard"],
    }),

    // =========================
    // SITE VISITS
    // =========================

    visits: b.query<
      any,
      {
        from?: string;
        to?: string;
      }
    >({
      query: (params) => ({
        url: "/site-visits",
        params,
      }),

      providesTags: ["Visits"],
    }),

    createVisit: b.mutation<any, any>({
      query: (body) => ({
        url: "/site-visits",
        method: "POST",
        body,
      }),

      invalidatesTags: ["Visits"],
    }),

    updateVisit: b.mutation<
      any,
      {
        id: number;
        body: any;
      }
    >({
      query: ({ id, body }) => ({
        url: `/site-visits/${id}`,
        method: "PATCH",
        body,
      }),

      invalidatesTags: ["Visits"],
    }),

    // =========================
    // DASHBOARD
    // =========================

    dashboard: b.query<
      any,
      {
        from: string;
        to: string;
        tz: string;
      }
    >({
      query: (params) => ({
        url: "/dashboard",
        params,
      }),

      providesTags: ["Dashboard"],
    }),

    // =========================
    // MASTER DATA
    // =========================

    masterData: b.query<any, void>({
      query: () => "/master-data",

      providesTags: ["MasterData"],
    }),

    // =========================
    // USERS
    // =========================

    users: b.query<
      any,
      {
        search?: string;
        includeInactive?: boolean;
      }
    >({
      query: (params) => ({
        url: "/users",
        params,
      }),

      providesTags: ["Users"],
    }),

    invites: b.query<any, void>({
      query: () => "/invites",

      providesTags: ["Users"],
    }),

    team: b.query<any, void>({
      query: () => "/team",
    }),
  }),
});

export const AUTH_URL = AUTH;
export const CRM_URL = CRM;

export const {
  usePropertiesQuery,
  usePropertyQuery,

  useCreatePropertyMutation,
  useUpdatePropertyMutation,
  useBulkPropertiesMutation,
  useDeletePropertyMutation,

  useVisitsQuery,
  useCreateVisitMutation,
  useUpdateVisitMutation,

  useDashboardQuery,

  useMasterDataQuery,

  useUsersQuery,
  useInvitesQuery,
  useTeamQuery,
} = api;