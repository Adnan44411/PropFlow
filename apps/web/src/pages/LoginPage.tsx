import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";

import { setSession } from "../app/store";
import { AUTH_URL } from "../app/api";

type DemoRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "AGENT";

type DemoUser = {
  email: string;
  password: string;
  name: string;
  role: DemoRole;
  tenantId: number;
};

const demos: DemoUser[] = [
  {
    email: "super@propflow.dev",
    password: "PropFlow@123",
    name: "Platform Super Admin",
    role: "SUPER_ADMIN",
    tenantId: 0,
  },
  {
    email: "admin@skyline.dev",
    password: "PropFlow@123",
    name: "Skyline Admin",
    role: "ADMIN",
    tenantId: 1,
  },
  {
    email: "manager@skyline.dev",
    password: "PropFlow@123",
    name: "Skyline Manager",
    role: "MANAGER",
    tenantId: 1,
  },
  {
    email: "riya@skyline.dev",
    password: "PropFlow@123",
    name: "Riya Sharma",
    role: "AGENT",
    tenantId: 1,
  },
];

export function LoginPage() {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [email, setEmail] = useState("admin@skyline.dev");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");

  const login = async () => {
    setError("");

    try {
      const response = await fetch(`${AUTH_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(
          data?.error?.message ||
            data?.message ||
            "Invalid email or password."
        );
        return;
      }

      dispatch(
        setSession({
          user: {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            role: data.user.role,
            tenantId: data.user.tenantId,
            tenantName: data.tenant?.name,
          },
          accessToken: data.accessToken,
          demo: false,
        })
      );

      /* =========================
         ROLE BASED REDIRECT
      ========================= */

      if (data.user.role === "SUPER_ADMIN") {
        navigate("/platform/tenants", {
          replace: true,
        });

        return;
      }

      if (data.user.role === "AGENT") {
        navigate("/my-properties", {
          replace: true,
        });

        return;
      }

      navigate("/dashboard", {
        replace: true,
      });
    } catch {
      setError(
        "Unable to connect to the authentication server. Please try again."
      );
    }
  };

  const loginAs = (role: DemoRole) => {
    const demoUser = demos.find(
      (user) => user.role === role
    );

    if (!demoUser) {
      return;
    }

    setEmail(demoUser.email);
    setPassword(demoUser.password);
    setError("");
  };

  return (
    // <Box
    //   sx={{
    //     minHeight: "100vh",
    //     display: "flex",
    //     alignItems: "center",
    //     justifyContent: "center",
    //     p: 2,
    //     background:
    //       "linear-gradient(135deg, #050505 0%, #111827 100%)",
    //   }}
    // >
    <Box
  sx={{
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    p: 2,
    backgroundColor: "#050505",
  }}
>
    <Card
  sx={{
    width: "100%",
    maxWidth: 460,
    borderRadius: 4,
  }}
>
      {/* <Card
        sx={{
          width: "100%",
          maxWidth: 460,
          borderRadius: 4,
          backgroundColor: "#111827",
          color: "white",
        }}
      > */}
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          {/* Header */}

          <Stack spacing={1} sx={{ mb: 3 }}>
            <Typography
              variant="h4"
              fontWeight={800}
            >
              PropFlow
            </Typography>

            <Typography
              variant="body2"
              sx={{ color: "rgba(255,255,255,0.65)" }}
            >
              Real Estate CRM
            </Typography>
          </Stack>

          {/* Error */}

          {error && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
            >
              {error}
            </Alert>
          )}

          {/* Login Form */}

          <Stack spacing={2}>
            <TextField
              fullWidth
              label="Email"
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              autoComplete="email"
            />

            <TextField
              fullWidth
              label="Password"
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              autoComplete="current-password"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  login();
                }
              }}
            />

            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={login}
              sx={{
                py: 1.4,
                fontWeight: 700,
              }}
            >
              Login
            </Button>
          </Stack>

          <Divider
            sx={{
              my: 3,
              borderColor:
                "rgba(255,255,255,0.12)",
            }}
          />

          {/* Demo Accounts */}

          <Typography
            variant="subtitle2"
            sx={{ mb: 1.5 }}
          >
            Demo accounts
          </Typography>

          <Stack spacing={1}>
            <Button
              variant="outlined"
              fullWidth
              onClick={() => loginAs("SUPER_ADMIN")}
            >
              Login as Super Admin
            </Button>

            <Button
              variant="outlined"
              fullWidth
              onClick={() => loginAs("ADMIN")}
            >
              Login as Admin
            </Button>

            <Button
              variant="outlined"
              fullWidth
              onClick={() => loginAs("MANAGER")}
            >
              Login as Manager
            </Button>

            <Button
              variant="outlined"
              fullWidth
              onClick={() => loginAs("AGENT")}
            >
              Login as Agent
            </Button>
          </Stack>

          {/* Current selected account */}

          <Box sx={{ mt: 3 }}>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Typography
                variant="caption"
                sx={{
                  color:
                    "rgba(255,255,255,0.55)",
                }}
              >
                Selected:
              </Typography>

              <Chip
                size="small"
                label={email}
                variant="outlined"
              />
            </Stack>
          </Box>

          {/* Register */}

          <Button
            fullWidth
            sx={{ mt: 2 }}
            onClick={() => navigate("/register")}
          >
            Create an account
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}