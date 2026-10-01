
import {
  configureStore,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';

import { api } from './api';

export type Role =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'MANAGER'
  | 'AGENT';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  tenantId: number | null;
  tenantName?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  demo: boolean;
}

const initial: AuthState = {
  user: null,
  accessToken: null,
  demo: true,
};

const authSlice = createSlice({
  name: 'auth',

  initialState: initial,

  reducers: {
    setSession: (
      state,
      action: PayloadAction<{
        user: User;
        accessToken?: string;
        demo?: boolean;
      }>
    ) => {
      state.user = action.payload.user;
      state.accessToken =
        action.payload.accessToken ?? 'demo-token';
      state.demo = action.payload.demo ?? false;
    },

    logout: (state) => {
      state.user = null;
      state.accessToken = null;
    },
  },
});

export const {
  setSession,
  logout,
} = authSlice.actions;

export const store = configureStore({
  reducer: {
    auth: authSlice.reducer,

    // RTK Query reducer
    [api.reducerPath]: api.reducer,
  },

  // RTK Query middleware
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(api.middleware),
});

export type RootState = ReturnType<typeof store.getState>;

export type AppDispatch = typeof store.dispatch;

