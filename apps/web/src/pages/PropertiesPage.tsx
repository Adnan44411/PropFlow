import {
  useMemo,
  useState,
} from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import {
  Add,
  Close,
  Delete,
  Download,
  FilterAlt,
  Refresh,
} from "@mui/icons-material";

import {
  DataGrid,
  type GridColDef,
  type GridPaginationModel,
  type GridRowSelectionModel,
  type GridSortModel,
} from "@mui/x-data-grid";

import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import {
  PageHeader,
  money,
} from "./Common";

import {
  useBulkPropertiesMutation,
  useDeletePropertyMutation,
  useMasterDataQuery,
  usePropertiesQuery,
  useTeamQuery,
} from "../app/api";

import { useSelector } from "react-redux";

import type {
  RootState,
} from "../app/store";


/* =========================================================
   DEMO FALLBACK DATA
========================================================= */

const mock = Array.from(
  { length: 28 },
  (_, i) => ({
    id: i + 1,

    title: [
      "Modern 3BHK in Skyline",
      "Premium Villa",
      "Commercial Office",
      "Green View Apartment",
    ][i % 4],

    type: [
      "Apartment",
      "Villa",
      "Commercial",
      "Apartment",
    ][i % 4],

    listingType:
      i % 3 ? "SALE" : "RENT",

    bhk:
      (i % 4) + 1,

    priceInr:
      i % 3
        ? 8500000 + i * 125000
        : 45000 + i * 1500,

    carpetAreaSqft:
      850 + i * 47,

    locality: [
      "Bandra West",
      "Andheri East",
      "Gurugram",
      "Kankarbagh",
    ][i % 4],

    assignee: [
      "Riya Sharma",
      "Kabir Singh",
      "Neha Kapoor",
    ][i % 3],

    status: [
      "Listed",
      "Site Visit",
      "Negotiation",
      "Closed",
    ][i % 4],

    createdAt:
      `2026-09-${String((i % 9) + 1).padStart(2, "0")}`,
  }),
);


/* =========================================================
   HELPERS
========================================================= */

function getErrorMessage(error: any): string {
  if (!error) {
    return "Something went wrong.";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error?.data?.message) {
    return error.data.message;
  }

  if (error?.data?.error) {
    return error.data.error;
  }

  if (error?.data?.code) {
    return error.data.code;
  }

  if (error?.error) {
    return error.error;
  }

  return "Something went wrong. Please try again.";
}


/* =========================================================
   MAIN PAGE
========================================================= */

export function PropertiesPage() {
  const user =
    useSelector(
      (state: RootState) => state.auth.user,
    );

  const nav =
    useNavigate();

  const [
    params,
    setParams,
  ] =
    useSearchParams();


  /* =======================================================
     BASIC FILTER STATE
  ======================================================= */

  const [
    q,
    setQ,
  ] =
    useState(
      params.get("q") || "",
    );

  const [
    type,
    setType,
  ] =
    useState(
      params.get("type") || "All",
    );

  const [
    listing,
    setListing,
  ] =
    useState(
      params.get("listingType") || "All",
    );


  /* =======================================================
     ADVANCED FILTER STATE
  ======================================================= */

  const [
    filterOpen,
    setFilterOpen,
  ] =
    useState(false);

  const [
    priceMin,
    setPriceMin,
  ] =
    useState(
      params.get("priceMin") || "",
    );

  const [
    priceMax,
    setPriceMax,
  ] =
    useState(
      params.get("priceMax") || "",
    );

  const [
    areaMin,
    setAreaMin,
  ] =
    useState(
      params.get("areaMin") || "",
    );

  const [
    areaMax,
    setAreaMax,
  ] =
    useState(
      params.get("areaMax") || "",
    );

  const [
    bhk,
    setBhk,
  ] =
    useState(
      params.get("bhk") || "",
    );

  const [
    locality,
    setLocality,
  ] =
    useState(
      params.get("locality") || "",
    );

  const [
    assignee,
    setAssignee,
  ] =
    useState(
      params.get("assignee") || "",
    );

  const [
    stale,
    setStale,
  ] =
    useState(
      params.get("stale") === "true",
    );


  /* =======================================================
     PAGINATION
  ======================================================= */

  const [
    paginationModel,
    setPaginationModel,
  ] =
    useState<GridPaginationModel>({
      page:
        Math.max(
          Number(
            params.get("page") || 1,
          ) - 1,
          0,
        ),

      pageSize:
        Number(
          params.get("pageSize") || 25,
        ),
    });


  /* =======================================================
     SORTING
  ======================================================= */

  const [
    sortModel,
    setSortModel,
  ] =
    useState<GridSortModel>([
      {
        field:
          params.get("sortBy") ||
          "createdAt",

        sort:
          (params.get("sortOrder") as
            | "asc"
            | "desc") ||
          "desc",
      },
    ]);


  /* =======================================================
     SELECTION
  ======================================================= */

  const [
    selection,
    setSelection,
  ] =
    useState<GridRowSelectionModel>([]);


  /* =======================================================
     DIALOG STATE
  ======================================================= */

  const [
    bulkAction,
    setBulkAction,
  ] =
    useState<
      "reassign"
      | "changeStatus"
      | "addAmenity"
      | null
    >(null);

  const [
    selectedAssignee,
    setSelectedAssignee,
  ] =
    useState("");

  const [
    selectedStatus,
    setSelectedStatus,
  ] =
    useState("");

  const [
    selectedAmenity,
    setSelectedAmenity,
  ] =
    useState("");

  const [
    deleteId,
    setDeleteId,
  ] =
    useState<number | null>(null);


  /* =======================================================
     SNACKBAR
  ======================================================= */

  const [
    snackbar,
    setSnackbar,
  ] =
    useState<{
      open: boolean;
      message: string;
      severity: "success" | "error";
    }>({
      open: false,
      message: "",
      severity: "success",
    });


  /* =======================================================
     API QUERIES
  ======================================================= */

  const real =
    usePropertiesQuery({
      params: {
        page:
          paginationModel.page + 1,

        pageSize:
          paginationModel.pageSize,

        q:
          q || undefined,

        type:
          type === "All"
            ? undefined
            : type,

        listingType:
          listing === "All"
            ? undefined
            : listing,

        priceMin:
          priceMin || undefined,

        priceMax:
          priceMax || undefined,

        areaMin:
          areaMin || undefined,

        areaMax:
          areaMax || undefined,

        bhk:
          bhk || undefined,

        locality:
          locality || undefined,

        assignee:
          assignee || undefined,

        stale:
          stale
            ? true
            : undefined,

        sortBy:
          sortModel[0]?.field ||
          "createdAt",

        sortOrder:
          sortModel[0]?.sort ||
          "desc",
      },
    });


  const team =
    useTeamQuery();

  const master =
    useMasterDataQuery();


  const [
    bulkProperties,
    bulkState,
  ] =
    useBulkPropertiesMutation();

  const [
    deleteProperty,
    deleteState,
  ] =
    useDeletePropertyMutation();


  /* =======================================================
     ROLE
  ======================================================= */

  const role =
    user?.role || "AGENT";

  const canBulk =
    role === "ADMIN" ||
    role === "MANAGER";

  const canDelete =
    role === "ADMIN" ||
    role === "MANAGER";

  const canExport =
    role === "ADMIN" ||
    role === "MANAGER";


  /* =======================================================
     DATA
  ======================================================= */

  const data =
    user && real.data?.data
      ? real.data.data
      : mock;

  const total =
    real.data?.total ??
    10482;


  /* =======================================================
     MASTER DATA NORMALIZATION
  ======================================================= */

  const teamItems =
    useMemo(() => {
      const source =
        team.data;

      if (Array.isArray(source)) {
        return source;
      }

      if (Array.isArray(source?.data)) {
        return source.data;
      }

      if (Array.isArray(source?.users)) {
        return source.users;
      }

      return [];
    }, [team.data]);


  const masterData =
    useMemo(() => {
      const source =
        master.data;

      if (!source) {
        return {
          statuses: [],
          amenities: [],
          types: [],
          localities: [],
        };
      }

      return {
        statuses:
          source.statuses ||
          source.propertyStatuses ||
          [],

        amenities:
          source.amenities ||
          [],

        types:
          source.types ||
          source.propertyTypes ||
          [],

        localities:
          source.localities ||
          [],
      };
    }, [master.data]);


  /* =======================================================
     URL HELPERS
  ======================================================= */

  function updateUrl(
    key: string,
    value: string,
  ) {
    setParams((current) => {
      const next =
        new URLSearchParams(current);

      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }

      return next;
    });
  }


  /* =======================================================
     BASIC FILTER HANDLERS
  ======================================================= */

  function handleSearch(
    value: string,
  ) {
    setQ(value);

    updateUrl(
      "q",
      value,
    );

    setPaginationModel((old) => ({
      ...old,
      page: 0,
    }));
  }


  function handleListing(
    value: string,
  ) {
    setListing(value);

    updateUrl(
      "listingType",
      value === "All"
        ? ""
        : value,
    );
  }


  function handleType(
    value: string,
  ) {
    setType(value);

    updateUrl(
      "type",
      value === "All"
        ? ""
        : value,
    );
  }


  /* =======================================================
     ADVANCED FILTER APPLY
  ======================================================= */

  function applyFilters() {
    const values: Record<
      string,
      string
    > = {
      priceMin,
      priceMax,
      areaMin,
      areaMax,
      bhk,
      locality,
      assignee,
      stale: stale
        ? "true"
        : "",
    };

    setParams((current) => {
      const next =
        new URLSearchParams(current);

      Object.entries(values).forEach(
        ([key, value]) => {
          if (value) {
            next.set(
              key,
              value,
            );
          } else {
            next.delete(key);
          }
        },
      );

      return next;
    });

    setPaginationModel((old) => ({
      ...old,
      page: 0,
    }));

    setFilterOpen(false);

    showSuccess(
      "Filters applied.",
    );
  }


  function clearFilters() {
    setPriceMin("");
    setPriceMax("");
    setAreaMin("");
    setAreaMax("");
    setBhk("");
    setLocality("");
    setAssignee("");
    setStale(false);

    setParams((current) => {
      const next =
        new URLSearchParams(current);

      [
        "priceMin",
        "priceMax",
        "areaMin",
        "areaMax",
        "bhk",
        "locality",
        "assignee",
        "stale",
      ].forEach((key) =>
        next.delete(key),
      );

      return next;
    });

    setPaginationModel((old) => ({
      ...old,
      page: 0,
    }));
  }


  /* =======================================================
     SORTING
  ======================================================= */

  function handleSort(
    model: GridSortModel,
  ) {
    setSortModel(model);

    const sort =
      model[0];

    setParams((current) => {
      const next =
        new URLSearchParams(current);

      if (sort?.field) {
        next.set(
          "sortBy",
          sort.field,
        );

        next.set(
          "sortOrder",
          sort.sort ||
            "desc",
        );
      } else {
        next.delete(
          "sortBy",
        );

        next.delete(
          "sortOrder",
        );
      }

      return next;
    });
  }


  /* =======================================================
     PAGINATION
  ======================================================= */

  function handlePagination(
    model: GridPaginationModel,
  ) {
    setPaginationModel(model);

    setParams((current) => {
      const next =
        new URLSearchParams(current);

      next.set(
        "page",
        String(model.page + 1),
      );

      next.set(
        "pageSize",
        String(model.pageSize),
      );

      return next;
    });
  }


  /* =======================================================
     SNACKBAR HELPERS
  ======================================================= */

  function showSuccess(
    message: string,
  ) {
    setSnackbar({
      open: true,
      message,
      severity: "success",
    });
  }


  function showError(
    message: string,
  ) {
    setSnackbar({
      open: true,
      message,
      severity: "error",
    });
  }


  /* =======================================================
     BULK ACTION
  ======================================================= */

  async function executeBulkAction() {
    const ids =
      selection.map(Number);

    if (!ids.length) {
      showError(
        "Select at least one property.",
      );

      return;
    }

    try {
      if (
        bulkAction === "reassign"
      ) {
        if (!selectedAssignee) {
          showError(
            "Please select an agent.",
          );

          return;
        }

        await bulkProperties({
          action:
            "reassign",

          ids,

          assigneeId:
            Number(
              selectedAssignee,
            ),
        }).unwrap();

        showSuccess(
          `${ids.length} properties reassigned successfully.`,
        );
      }


      if (
        bulkAction === "changeStatus"
      ) {
        if (!selectedStatus) {
          showError(
            "Please select a status.",
          );

          return;
        }

        await bulkProperties({
          action:
            "changeStatus",

          ids,

          statusId:
            Number(
              selectedStatus,
            ),
        }).unwrap();

        showSuccess(
          `${ids.length} properties updated successfully.`,
        );
      }


      if (
        bulkAction === "addAmenity"
      ) {
        if (!selectedAmenity) {
          showError(
            "Please select an amenity.",
          );

          return;
        }

        await bulkProperties({
          action:
            "addAmenity",

          ids,

          amenityId:
            Number(
              selectedAmenity,
            ),
        }).unwrap();

        showSuccess(
          `Amenity added to ${ids.length} properties.`,
        );
      }


      setSelection([]);

      setBulkAction(null);

      setSelectedAssignee("");
      setSelectedStatus("");
      setSelectedAmenity("");
    } catch (error) {
      showError(
        getErrorMessage(error),
      );
    }
  }


  /* =======================================================
     DELETE
  ======================================================= */

  async function confirmDelete() {
    if (deleteId == null) {
      return;
    }

    try {
      await deleteProperty(
        deleteId,
      ).unwrap();

      showSuccess(
        "Property deleted successfully.",
      );

      setDeleteId(null);
    } catch (error) {
      showError(
        getErrorMessage(error),
      );
    }
  }


  /* =======================================================
     EXPORT
  ======================================================= */

  async function exportProperties() {
    try {
      const query =
        new URLSearchParams();

      query.set(
        "q",
        q,
      );

      if (
        type !== "All"
      ) {
        query.set(
          "type",
          type,
        );
      }

      if (
        listing !== "All"
      ) {
        query.set(
          "listingType",
          listing,
        );
      }

      if (priceMin) {
        query.set(
          "priceMin",
          priceMin,
        );
      }

      if (priceMax) {
        query.set(
          "priceMax",
          priceMax,
        );
      }

      if (areaMin) {
        query.set(
          "areaMin",
          areaMin,
        );
      }

      if (areaMax) {
        query.set(
          "areaMax",
          areaMax,
        );
      }

      if (bhk) {
        query.set(
          "bhk",
          bhk,
        );
      }

      if (locality) {
        query.set(
          "locality",
          locality,
        );
      }

      if (assignee) {
        query.set(
          "assignee",
          assignee,
        );
      }

      if (stale) {
        query.set(
          "stale",
          "true",
        );
      }

      const sort =
        sortModel[0];

      if (sort?.field) {
        query.set(
          "sortBy",
          sort.field,
        );

        query.set(
          "sortOrder",
          sort.sort ||
            "desc",
        );
      }

      const baseUrl =
        import.meta.env
          .VITE_CRM_API_URL ||
        "http://localhost:5001";

      const token =
        (
          user as any
        )?.accessToken;

      const headers:
        Record<
          string,
          string
        > = {};

      if (
        token &&
        token !==
          "demo-token"
      ) {
        headers.Authorization =
          `Bearer ${token}`;
      }

      const response =
        await fetch(
          `${baseUrl}/properties/export?${query.toString()}`,
          {
            method:
              "GET",

            credentials:
              "include",

            headers,
          },
        );

      if (!response.ok) {
        let message =
          "Export failed.";

        try {
          const body =
            await response.json();

          message =
            body?.message ||
            body?.error ||
            message;
        } catch {
          // Ignore non-JSON error responses.
        }

        throw new Error(
          message,
        );
      }

      const blob =
        await response.blob();

      const url =
        window.URL.createObjectURL(
          blob,
        );

      const link =
        document.createElement(
          "a",
        );

      link.href = url;

      link.download =
        `properties-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`;

      document.body.appendChild(
        link,
      );

      link.click();

      link.remove();

      window.URL.revokeObjectURL(
        url,
      );

      showSuccess(
        "Excel export downloaded.",
      );
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : getErrorMessage(error),
      );
    }
  }


  /* =======================================================
     COLUMNS
  ======================================================= */

  const columns =
    useMemo<GridColDef[]>(
      () => [
        {
          field:
            "title",

          headerName:
            "Property",

          flex: 1.5,

          minWidth: 240,

          renderCell:
            (params) => (
              <Typography
                fontWeight={700}
                className="clickable"
                sx={{
                  cursor:
                    "pointer",
                }}
                onClick={() =>
                  nav(
                    `/properties/${params.row.id}`,
                  )
                }
              >
                {params.value}
              </Typography>
            ),
        },

        {
          field:
            "status",

          headerName:
            "Status",

          width: 140,

          renderCell:
            (params) => (
              <Chip
                size="small"
                label={
                  typeof params.value === "object" && params.value !== null
                    ? params.value.name || "Unknown"
                    : params.value || "Unknown"
                }
              />
            ),
        },

        {
          field:
            "type",

          headerName:
            "Type",

          width: 130,

          renderCell:
            (params) => (
              typeof params.value === "object" && params.value !== null
                ? params.value.name || "Unknown"
                : params.value || "Unknown"
            ),
        },

        {
          field:
            "listingType",

          headerName:
            "Sale / Rent",

          width: 120,

          renderCell:
            (params) => (
              <Chip
                size="small"
                variant="outlined"
                label={
                  params.value
                }
              />
            ),
        },

        {
          field:
            "bhk",

          headerName:
            "BHK",

          width: 80,
        },

        {
          field:
            "priceInr",

          headerName:
            "Price",

          width: 140,

          renderCell:
            (params) =>
              money(
                params.value,
              ),
        },

        {
          field:
            "carpetAreaSqft",

          headerName:
            "Area",

          width: 110,

          renderCell:
            (params) =>
              `${params.value} sqft`,
        },

        {
          field:
            "locality",

          headerName:
            "Locality",

          width: 160,

          renderCell:
            (params) => (
              typeof params.value === "object" && params.value !== null
                ? params.value.name || "Unknown"
                : params.value || "Unknown"
            ),
        },

        {
          field:
            "assignee",

          headerName:
            "Agent",

          width: 150,

          renderCell:
            (params) => (
              typeof params.value === "object" && params.value !== null
                ? params.value.name || "Unassigned"
                : params.value || "Unassigned"
            ),
        },

        {
          field:
            "createdAt",

          headerName:
            "Created",

          width: 130,
        },

        ...(canDelete
          ? [
              {
                field:
                  "actions",

                headerName:
                  "Actions",

                width: 90,

                sortable:
                  false,

                filterable:
                  false,

                renderCell:
                  (params: any) => (
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() =>
                          setDeleteId(
                            Number(
                              params.row.id,
                            ),
                          )
                        }
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ),
              } as GridColDef,
            ]
          : []),
      ],
      [
        nav,
        canDelete,
      ],
    );


  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <Box className="page">

      {/* =================================================
          HEADER
      ================================================= */}

      <PageHeader
        title={
          role === "AGENT"
            ? "My Properties"
            : "Properties"
        }

        subtitle="Server-ready property inventory with URL-synced filters"

        action={
          [
            "ADMIN",
            "MANAGER",
            "AGENT",
          ].includes(role)
            ? (
              <Button
                variant="contained"
                startIcon={
                  <Add />
                }
                onClick={() =>
                  nav(
                    "/properties/new",
                  )
                }
              >
                Add property
              </Button>
            )
            : null
        }
      />


      {/* =================================================
          FILTER BAR
      ================================================= */}

      <Paper
        sx={{
          p: 2,
          mb: 2,
        }}
      >

        <Stack
          direction={{
            xs: "column",
            md: "row",
          }}
          spacing={1.5}
        >

          {/* SEARCH */}

          <TextField
            size="small"
            placeholder="Search title, building, unit, owner..."
            value={q}
            onChange={(event) =>
              handleSearch(
                event.target.value,
              )
            }
            sx={{
              flex: 1,
            }}
          />


          {/* SALE / RENT */}

          <TextField
            size="small"
            select
            value={listing}
            onChange={(event) =>
              handleListing(
                event.target.value,
              )
            }
            sx={{
              minWidth: 140,
            }}
          >
            <MenuItem value="All">
              Sale / Rent
            </MenuItem>

            <MenuItem value="SALE">
              Sale
            </MenuItem>

            <MenuItem value="RENT">
              Rent
            </MenuItem>
          </TextField>


          {/* TYPE */}

          <TextField
            size="small"
            select
            value={type}
            onChange={(event) =>
              handleType(
                event.target.value,
              )
            }
            sx={{
              minWidth: 150,
            }}
          >
            <MenuItem value="All">
              All types
            </MenuItem>

            <MenuItem value="1">
              Apartment
            </MenuItem>

            <MenuItem value="2">
              Villa
            </MenuItem>

            <MenuItem value="3">
              Plot
            </MenuItem>

            <MenuItem value="4">
              Commercial
            </MenuItem>
          </TextField>


          {/* ADVANCED FILTER */}

          <Button
            startIcon={
              <FilterAlt />
            }
            onClick={() =>
              setFilterOpen(
                true,
              )
            }
          >
            Filters
          </Button>


          {/* RESET */}

          <Button
            startIcon={
              <Refresh />
            }
            onClick={() =>
              clearFilters()
            }
          >
            Reset
          </Button>


          {/* EXPORT */}

          {canExport && (
            <Button
              startIcon={
                <Download />
              }
              onClick={
                exportProperties
              }
            >
              Export
            </Button>
          )}

        </Stack>


        {/* =================================================
            BULK ACTION BAR
        ================================================= */}

        {selection.length >
          0 &&
          canBulk && (
            <Stack
              direction={{
                xs: "column",
                sm: "row",
              }}
              spacing={1}
              sx={{
                mt: 2,
                alignItems: {
                  xs: "stretch",
                  sm: "center",
                },
              }}
            >

              <Chip
                label={`${selection.length} selected`}
              />

              <Button
                size="small"
                variant="outlined"
                onClick={() =>
                  setBulkAction(
                    "reassign",
                  )
                }
              >
                Reassign
              </Button>

              <Button
                size="small"
                variant="outlined"
                onClick={() =>
                  setBulkAction(
                    "changeStatus",
                  )
                }
              >
                Change status
              </Button>

              <Button
                size="small"
                variant="outlined"
                onClick={() =>
                  setBulkAction(
                    "addAmenity",
                  )
                }
              >
                Add amenity
              </Button>

            </Stack>
          )}

      </Paper>


      {/* =================================================
          DATA GRID
      ================================================= */}

      <Paper
        sx={{
          height: 650,
          width: "100%",
        }}
      >

        <DataGrid
          rows={data}
          columns={columns}

          checkboxSelection={
            canBulk
          }

          disableRowSelectionOnClick

          pagination

          paginationMode="server"

          sortingMode="server"

          filterMode="server"

          rowCount={
            total
          }

          paginationModel={
            paginationModel
          }

          onPaginationModelChange={
            handlePagination
          }

          sortModel={
            sortModel
          }

          onSortModelChange={
            handleSort
          }

          pageSizeOptions={[
            25,
            50,
            100,
          ]}

          onRowSelectionModelChange={
            setSelection
          }

          loading={
            real.isFetching
          }

          disableColumnFilter

          disableColumnMenu={false}

          getRowId={(row) =>
            row.id
          }
        />

      </Paper>


      {/* =================================================
          ADVANCED FILTER DIALOG
      ================================================= */}

      <Dialog
        open={filterOpen}
        onClose={() =>
          setFilterOpen(
            false,
          )
        }
        fullWidth
        maxWidth="sm"
      >

        <DialogTitle>
          Advanced filters

          <IconButton
            onClick={() =>
              setFilterOpen(
                false,
              )
            }
            sx={{
              float: "right",
            }}
          >
            <Close />
          </IconButton>
        </DialogTitle>


        <DialogContent>

          <Stack
            spacing={2}
            sx={{
              pt: 1,
            }}
          >

            <Typography
              variant="subtitle2"
              fontWeight={700}
            >
              Price range
            </Typography>


            <Stack
              direction="row"
              spacing={2}
            >

              <TextField
                fullWidth
                size="small"
                label="Minimum price"
                type="number"
                value={
                  priceMin
                }
                onChange={(event) =>
                  setPriceMin(
                    event.target
                      .value,
                  )
                }
              />

              <TextField
                fullWidth
                size="small"
                label="Maximum price"
                type="number"
                value={
                  priceMax
                }
                onChange={(event) =>
                  setPriceMax(
                    event.target
                      .value,
                  )
                }
              />

            </Stack>


            <Typography
              variant="subtitle2"
              fontWeight={700}
            >
              Carpet area
            </Typography>


            <Stack
              direction="row"
              spacing={2}
            >

              <TextField
                fullWidth
                size="small"
                label="Minimum sqft"
                type="number"
                value={
                  areaMin
                }
                onChange={(event) =>
                  setAreaMin(
                    event.target
                      .value,
                  )
                }
              />

              <TextField
                fullWidth
                size="small"
                label="Maximum sqft"
                type="number"
                value={
                  areaMax
                }
                onChange={(event) =>
                  setAreaMax(
                    event.target
                      .value,
                  )
                }
              />

            </Stack>


            {/* BHK */}

            <FormControl
              fullWidth
              size="small"
            >

              <InputLabel>
                BHK
              </InputLabel>

              <Select
                value={
                  bhk
                }
                label="BHK"
                onChange={(event) =>
                  setBhk(
                    event.target
                      .value,
                  )
                }
              >

                <MenuItem value="">
                  All BHK
                </MenuItem>

                {Array.from(
                  {
                    length: 21,
                  },
                  (_, i) => (
                    <MenuItem
                      key={i}
                      value={String(i)}
                    >
                      {i === 0
                        ? "0 / Plot / Commercial"
                        : `${i} BHK`}
                    </MenuItem>
                  ),
                )}

              </Select>

            </FormControl>


            {/* LOCALITY */}

            <TextField
              fullWidth
              size="small"
              label="Locality ID"
              type="number"
              value={
                locality
              }
              onChange={(event) =>
                setLocality(
                  event.target
                    .value,
                )
              }
              helperText="Backend expects locality ID"
            />


            {/* ASSIGNEE */}

            {canBulk && (
              <FormControl
                fullWidth
                size="small"
              >

                <InputLabel>
                  Assignee
                </InputLabel>

                <Select
                  value={
                    assignee
                  }
                  label="Assignee"
                  onChange={(event) =>
                    setAssignee(
                      event.target
                        .value,
                    )
                  }
                >

                  <MenuItem value="">
                    All agents
                  </MenuItem>

                  {teamItems.map(
                    (agent: any) => (
                      <MenuItem
                        key={
                          agent.id
                        }
                        value={
                          String(
                            agent.id,
                          )
                        }
                      >
                        {agent.name ||
                          agent.fullName ||
                          agent.email ||
                          `User ${agent.id}`}
                      </MenuItem>
                    ),
                  )}

                </Select>

              </FormControl>
            )}


            {/* STALE */}

            <Button
              variant={
                stale
                  ? "contained"
                  : "outlined"
              }
              onClick={() =>
                setStale(
                  !stale,
                )
              }
              sx={{
                alignSelf:
                  "flex-start",
              }}
            >
              {stale
                ? "Showing stale properties"
                : "Only stale properties"}
            </Button>

          </Stack>

        </DialogContent>


        <DialogActions>

          <Button
            onClick={() =>
              clearFilters()
            }
          >
            Clear
          </Button>

          <Button
            onClick={() =>
              setFilterOpen(
                false,
              )
            }
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={
              applyFilters
            }
          >
            Apply filters
          </Button>

        </DialogActions>

      </Dialog>


      {/* =================================================
          BULK ACTION DIALOG
      ================================================= */}

      <Dialog
        open={
          bulkAction !==
          null
        }
        onClose={() =>
          setBulkAction(
            null,
          )
        }
        fullWidth
        maxWidth="sm"
      >

        <DialogTitle>
          {bulkAction ===
            "reassign" &&
            "Reassign properties"}

          {bulkAction ===
            "changeStatus" &&
            "Change property status"}

          {bulkAction ===
            "addAmenity" &&
            "Add amenity"}

          <IconButton
            onClick={() =>
              setBulkAction(
                null,
              )
            }
            sx={{
              float: "right",
            }}
          >
            <Close />
          </IconButton>
        </DialogTitle>


        <DialogContent>

          <Typography
            sx={{
              mb: 2,
            }}
          >
            You selected{" "}
            <strong>
              {selection.length}
            </strong>{" "}
            properties.
          </Typography>


          {/* REASSIGN */}

          {bulkAction ===
            "reassign" && (
            <FormControl
              fullWidth
              size="small"
            >

              <InputLabel>
                Assign to
              </InputLabel>

              <Select
                value={
                  selectedAssignee
                }
                label="Assign to"
                onChange={(event) =>
                  setSelectedAssignee(
                    event.target
                      .value,
                  )
                }
              >

                {teamItems.map(
                  (agent: any) => (
                    <MenuItem
                      key={
                        agent.id
                      }
                      value={
                        String(
                          agent.id,
                        )
                      }
                    >
                      {agent.name ||
                        agent.fullName ||
                        agent.email ||
                        `User ${agent.id}`}
                    </MenuItem>
                  ),
                )}

              </Select>

            </FormControl>
          )}


          {/* STATUS */}

          {bulkAction ===
            "changeStatus" && (
            <FormControl
              fullWidth
              size="small"
            >

              <InputLabel>
                New status
              </InputLabel>

              <Select
                value={
                  selectedStatus
                }
                label="New status"
                onChange={(event) =>
                  setSelectedStatus(
                    event.target
                      .value,
                  )
                }
              >

                {masterData.statuses.map(
                  (status: any) => (
                    <MenuItem
                      key={
                        status.id
                      }
                      value={
                        String(
                          status.id,
                        )
                      }
                    >
                      {status.name ||
                        status.label ||
                        `Status ${status.id}`}
                    </MenuItem>
                  ),
                )}

              </Select>

            </FormControl>
          )}


          {/* AMENITY */}

          {bulkAction ===
            "addAmenity" && (
            <FormControl
              fullWidth
              size="small"
            >

              <InputLabel>
                Amenity
              </InputLabel>

              <Select
                value={
                  selectedAmenity
                }
                label="Amenity"
                onChange={(event) =>
                  setSelectedAmenity(
                    event.target
                      .value,
                  )
                }
              >

                {masterData.amenities.map(
                  (amenity: any) => (
                    <MenuItem
                      key={
                        amenity.id
                      }
                      value={
                        String(
                          amenity.id,
                        )
                      }
                    >
                      {amenity.name ||
                        amenity.label ||
                        `Amenity ${amenity.id}`}
                    </MenuItem>
                  ),
                )}

              </Select>

            </FormControl>
          )}

        </DialogContent>


        <DialogActions>

          <Button
            onClick={() =>
              setBulkAction(
                null,
              )
            }
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            disabled={
              bulkState.isLoading
            }
            onClick={
              executeBulkAction
            }
          >
            {bulkState.isLoading
              ? "Saving..."
              : "Apply"}
          </Button>

        </DialogActions>

      </Dialog>


      {/* =================================================
          DELETE DIALOG
      ================================================= */}

      <Dialog
        open={
          deleteId !== null
        }
        onClose={() =>
          setDeleteId(null)
        }
      >

        <DialogTitle>
          Delete property?
        </DialogTitle>

        <DialogContent>

          <Typography>
            This will remove the property
            from the active inventory.
          </Typography>

        </DialogContent>

        <DialogActions>

          <Button
            onClick={() =>
              setDeleteId(null)
            }
          >
            Cancel
          </Button>

          <Button
            color="error"
            variant="contained"
            disabled={
              deleteState.isLoading
            }
            onClick={
              confirmDelete
            }
          >
            {deleteState.isLoading
              ? "Deleting..."
              : "Delete"}
          </Button>

        </DialogActions>

      </Dialog>


      {/* =================================================
          SNACKBAR
      ================================================= */}

      <Snackbar
        open={
          snackbar.open
        }
        autoHideDuration={
          4000
        }
        onClose={() =>
          setSnackbar(
            (old) => ({
              ...old,
              open: false,
            }),
          )
        }
      >

        <Alert
          severity={
            snackbar.severity
          }
          variant="filled"
          onClose={() =>
            setSnackbar(
              (old) => ({
                ...old,
                open: false,
              }),
            )
          }
        >
          {
            snackbar.message
          }
        </Alert>

      </Snackbar>

    </Box>
  );
}
