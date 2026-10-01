import { createTheme } from "@mui/material/styles";
import type {} from "@mui/x-data-grid/themeAugmentation";

export const theme = createTheme({
  palette: {
    primary: {
      main: "#2563eb",
    },

    secondary: {
      main: "#7c3aed",
    },

    background: {
      default: "#f6f8fb",
      paper: "#ffffff",
    },
  },

  shape: {
    borderRadius: 12,
  },

  typography: {
    fontFamily: "Inter, Roboto, Arial, sans-serif",

    h4: {
      fontWeight: 800,
    },

    h5: {
      fontWeight: 750,
    },

    h6: {
      fontWeight: 700,
    },
  },

  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },

      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 700,
        },
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow:
            "0 4px 24px rgba(15,23,42,.06)",
          border:
            "1px solid #e2e8f0",
        },
      },
    },

    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: 0,
        },
      },
    },
  },
});