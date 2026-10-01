import { useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

import {
  CalendarMonth,
  OpenInNew,
} from "@mui/icons-material";

import {
  DataGrid,
  type GridColDef,
  type GridPaginationModel,
  type GridSortModel,
} from "@mui/x-data-grid";

import dayjs from "dayjs";

import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import { useSelector } from "react-redux";

import { PageHeader, money } from "./Common";

import {
  usePropertiesQuery,
  useVisitsQuery,
} from "../app/api";

import type { RootState } from "../app/store";

/* =========================================================
   MOCK DATA
   Used while backend/demo mode is not returning data.
========================================================= */

const mockProperties = [
  {
    id: 1,
    title: "Modern 3BHK in Skyline",
    type: "Apartment",
    listingType: "SALE",
    bhk: 3,
    priceInr: 12500000,
    carpetAreaSqft: 1450,
    locality: "Bandra West",
    status: "Listed",
    assignee: "Riya Sharma",
  },
  {
    id: 2,
    title: "Premium Villa",
    type: "Villa",
    listingType: "SALE",
    bhk: 4,
    priceInr: 28500000,
    carpetAreaSqft: 2400,
    locality: "Andheri East",
    status: "Site Visit",
    assignee: "Riya Sharma",
  },
  {
    id: 3,
    title: "Green View Apartment",
    type: "Apartment",
    listingType: "RENT",
    bhk: 2,
    priceInr: 42000,
    carpetAreaSqft: 980,
    locality: "Gurugram",
    status: "Negotiation",
    assignee: "Riya Sharma",
  },
  {
    id: 4,
    title: "City Centre Office",
    type: "Commercial",
    listingType: "SALE",
    bhk: 0,
    priceInr: 18500000,
    carpetAreaSqft: 1800,
    locality: "Kankarbagh",
    status: "Listed",
    assignee: "Riya Sharma",
  },
];

const mockVisits = [
  {
    id: 1,
    propertyId: 2,
    property: "Premium Villa",
    client: "Arjun Mehta",
    time: "Today · 11:00 AM",
    status: "Today",
  },
  {
    id: 2,
    propertyId: 1,
    property: "Modern 3BHK in Skyline",
    client: "Priya Singh",
    time: "Today · 3:30 PM",
    status: "Today",
  },
  {
    id: 3,
    propertyId: 3,
    property: "Green View Apartment",
    client: "Rahul Kumar",
    time: "Yesterday · 5:00 PM",
    status: "Overdue",
  },
];

/* =========================================================
   TYPES
========================================================= */

type Visit = {
  id: number | string;
  propertyId?: number | string;

  property?: string | {
    title?: string;
  };

  propertyTitle?: string;

  client?: string;

  clientName?: string;

  time?: string;

  visitAt?: string;

  status?: string;
};

/* =========================================================
   HELPERS
========================================================= */

/**
 * Converts visit status/time into:
 *
 * - Today
 * - Overdue
 * - null
 *
 * Backend visitAt is expected to be UTC ISO time.
 */
function getVisitState(visit: Visit): "Today" | "Overdue" | null {
  /*
   * Support existing mock data.
   */
  if (visit.status === "Today") {
    return "Today";
  }

  if (visit.status === "Overdue") {
    return "Overdue";
  }

  /*
   * If backend does not provide visitAt,
   * there is nothing to calculate.
   */
  if (!visit.visitAt) {
    return null;
  }

  /*
   * Completed/cancelled visits should not appear
   * in Today's & overdue section.
   */
  const normalizedStatus = String(
    visit.status ?? ""
  ).toUpperCase();

  if (
    normalizedStatus === "COMPLETED" ||
    normalizedStatus === "CANCELLED" ||
    normalizedStatus === "CANCELED"
  ) {
    return null;
  }

  /*
   * Backend stores UTC.
   *
   * dayjs converts the ISO timestamp to local time
   * for comparison/display.
   */
  // const visitTime = dayjs(visit.visitAt);
  const visitTime = dayjs(visit.visitAt);

  if (!visitTime.isValid()) {
    return null;
  }

  const now = dayjs();

  /*
   * Past visit = overdue.
   */
  if (visitTime.isBefore(now)) {
    return "Overdue";
  }

  /*
   * Future visit happening today.
   */
  if (visitTime.isSame(now, "day")) {
    return "Today";
  }

  /*
   * Tomorrow/future visit does not belong
   * to the pinned section.
   */
  return null;
}

/**
 * Get property title from different possible API shapes.
 */
function getPropertyName(visit: Visit): string {
  if (typeof visit.property === "string") {
    return visit.property;
  }

  if (
    visit.property &&
    typeof visit.property === "object" &&
    visit.property.title
  ) {
    return visit.property.title;
  }

  if (visit.propertyTitle) {
    return visit.propertyTitle;
  }

  return "Property";
}

/**
 * Get client name from different possible API shapes.
 */
function getClientName(visit: Visit): string {
  return (
    visit.client ??
    visit.clientName ??
    "Client"
  );
}

/**
 * Format UTC visitAt into user's local timezone.
 */
function formatVisitTime(visit: Visit): string {
  /*
   * Mock visit already has a display string.
   */
  if (!visit.visitAt) {
    return visit.time ?? "Time not available";
  }

const parsed = dayjs(visit.visitAt);

  if (!parsed.isValid()) {
    return visit.time ?? "Time not available";
  }

  return parsed.format("ddd, DD MMM · h:mm A");
}

/* =========================================================
   PAGE
========================================================= */

export function MyPropertiesPage() {
  const navigate = useNavigate();

  const [params, setParams] = useSearchParams();

  const user = useSelector(
    (state: RootState) => state.auth.user
  );

  /* =======================================================
     URL-SYNCED PAGINATION
  ======================================================= */

  const [paginationModel, setPaginationModel] =
    useState<GridPaginationModel>(() => ({
      page: Number(params.get("page") || 0),
      pageSize: Number(params.get("pageSize") || 25),
    }));

  /* =======================================================
     URL-SYNCED SORTING
  ======================================================= */

  const [sortModel, setSortModel] =
    useState<GridSortModel>(() => {
      const sort = params.get("sort");
      const sortOrder = params.get("sortOrder");

      if (!sort) {
        return [];
      }

      return [
        {
          field: sort,
          sort:
            sortOrder === "desc"
              ? "desc"
              : "asc",
        },
      ];
    });

  /* =======================================================
     PROPERTIES API
  ======================================================= */

  const realProperties = usePropertiesQuery({
    params: {
      /*
       * DataGrid page starts at 0.
       *
       * Backend pagination generally starts at 1.
       */
      page: paginationModel.page + 1,

      pageSize: paginationModel.pageSize,

      /*
       * Backend should enforce agent ownership
       * from the authenticated token.
       *
       * This value is useful for the current frontend/demo
       * setup, but backend authorization must remain authoritative.
       */
      assigneeId: user?.id,

      /*
       * Server-side sorting.
       */
      sort:
        sortModel.length > 0
          ? sortModel[0].field
          : undefined,

      sortOrder:
        sortModel.length > 0
          ? sortModel[0].sort
          : undefined,
    },
  });

  /* =======================================================
     VISITS API
  ======================================================= */

  const realVisits = useVisitsQuery({});

  /* =======================================================
     PROPERTIES DATA
  ======================================================= */

  const properties = useMemo(() => {
    const serverRows =
      realProperties.data?.data;

    if (
      Array.isArray(serverRows) &&
      serverRows.length > 0
    ) {
      return serverRows;
    }

    return mockProperties;
  }, [realProperties.data]);

  /* =======================================================
     VISITS DATA
  ======================================================= */

  const visits = useMemo<Visit[]>(() => {
    const serverRows =
      realVisits.data?.data;

    if (
      Array.isArray(serverRows) &&
      serverRows.length > 0
    ) {
      return serverRows;
    }

    return mockVisits;
  }, [realVisits.data]);

  /* =======================================================
     TODAY + OVERDUE VISITS
  ======================================================= */

  const todayVisits = useMemo(() => {
    return visits
      .map((visit) => ({
        ...visit,
        computedStatus:
          getVisitState(visit),
      }))
      .filter(
        (visit) =>
          visit.computedStatus === "Today" ||
          visit.computedStatus === "Overdue"
      )
      .sort((a, b) => {
        /*
         * Overdue first, then today's visits.
         */
        if (
          a.computedStatus === "Overdue" &&
          b.computedStatus !== "Overdue"
        ) {
          return -1;
        }

        if (
          a.computedStatus !== "Overdue" &&
          b.computedStatus === "Overdue"
        ) {
          return 1;
        }

        /*
         * If both have visitAt, sort chronologically.
         */
        if (a.visitAt && b.visitAt) {
          return (
            dayjs(a.visitAt).valueOf() -
            dayjs(b.visitAt).valueOf()
          );
        }

        return 0;
      });
  }, [visits]);

  /* =======================================================
     PAGINATION HANDLER
  ======================================================= */

  const handlePaginationChange = (
    model: GridPaginationModel
  ) => {
    setPaginationModel(model);

    setParams((current) => {
      current.set(
        "page",
        String(model.page)
      );

      current.set(
        "pageSize",
        String(model.pageSize)
      );

      return current;
    });
  };

  /* =======================================================
     SORT HANDLER
  ======================================================= */

  const handleSortChange = (
    model: GridSortModel
  ) => {
    setSortModel(model);

    setParams((current) => {
      if (model.length === 0) {
        current.delete("sort");
        current.delete("sortOrder");
      } else {
        current.set(
          "sort",
          model[0].field
        );

        current.set(
          "sortOrder",
          model[0].sort === "desc"
            ? "desc"
            : "asc"
        );
      }

      return current;
    });
  };

  /* =======================================================
     DATA GRID COLUMNS
  ======================================================= */

  const columns: GridColDef[] = [
    {
      field: "title",
      headerName: "Property",
      flex: 1.4,
      minWidth: 220,

      renderCell: (params) => (
        <Typography
          fontWeight={700}
          sx={{
            cursor: "pointer",

            "&:hover": {
              textDecoration:
                "underline",
            },
          }}
          onClick={() =>
            navigate(
              `/properties/${params.row.id}`
            )
          }
        >
          {params.value}
        </Typography>
      ),
    },

    {
      field: "status",
      headerName: "Status",
      width: 130,

      renderCell: (params) => {
        const status =
          typeof params.value === "object" &&
          params.value !== null
            ? params.value.name
            : String(params.value ?? "");

        return (
          <Chip
            size="small"
            label={status}
            color={
              status === "Negotiation"
                ? "warning"
                : status === "Site Visit"
                  ? "info"
                  : "default"
            }
          />
        );
      },
    },

    {
      field: "type",
      headerName: "Type",
      width: 120,
    },

    {
      field: "listingType",
      headerName: "Sale/Rent",
      width: 110,

      renderCell: (params) => (
        <Chip
          size="small"
          variant="outlined"
          label={
            params.value === "SALE"
              ? "Sale"
              : "Rent"
          }
        />
      ),
    },

    {
      field: "bhk",
      headerName: "BHK",
      width: 80,
    },

    {
      field: "priceInr",
      headerName: "Price",
      width: 140,

      renderCell: (params) =>
        money(params.value),
    },

    {
      field: "carpetAreaSqft",
      headerName: "Area",
      width: 110,

      renderCell: (params) =>
        `${params.value} sqft`,
    },

    {
      field: "locality",
      headerName: "Locality",
      width: 150,
    },

    {
      field: "actions",
      headerName: "Open",
      width: 100,
      sortable: false,

      renderCell: (params) => (
        <Button
          size="small"
          startIcon={<OpenInNew />}
          onClick={() =>
            navigate(
              `/properties/${params.row.id}`
            )
          }
        >
          View
        </Button>
      ),
    },
  ];

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <Box className="page">

      {/* ===================================================
          HEADER
      =================================================== */}

      <PageHeader
        title="My Properties"
        subtitle="Properties assigned to you"
      />

      {/* ===================================================
          TODAY / OVERDUE VISITS
      =================================================== */}

      <Grid
        container
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Grid item xs={12}>
          <Card>
            <CardContent>

              <Stack
                direction={{
                  xs: "column",
                  sm: "row",
                }}
                justifyContent="space-between"
                alignItems={{
                  xs: "flex-start",
                  sm: "center",
                }}
                spacing={2}
                sx={{ mb: 2 }}
              >

                <Box>
                  <Typography variant="h6">
                    Today's & overdue visits
                  </Typography>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                  >
                    Follow up on your scheduled
                    site visits.
                  </Typography>
                </Box>

                <Button
                  variant="outlined"
                  startIcon={
                    <CalendarMonth />
                  }
                  onClick={() =>
                    navigate("/calendar")
                  }
                >
                  Open calendar
                </Button>

              </Stack>

              {/* =================================================
                  EMPTY STATE
              ================================================= */}

              {todayVisits.length === 0 ? (
                <Alert severity="success">
                  No today's or overdue
                  visits.
                </Alert>
              ) : (

                /* ===============================================
                   VISIT LIST
                =============================================== */

                <Stack spacing={1.5}>

                  {todayVisits.map(
                    (visit) => (
                      <Paper
                        key={visit.id}
                        variant="outlined"
                        sx={{
                          p: 2,
                        }}
                      >

                        <Stack
                          direction={{
                            xs: "column",
                            sm: "row",
                          }}
                          spacing={1}
                          justifyContent="space-between"
                          alignItems={{
                            xs: "flex-start",
                            sm: "center",
                          }}
                        >

                          <Box>

                            <Typography
                              fontWeight={700}
                            >
                              {getPropertyName(
                                visit
                              )}
                            </Typography>

                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              Client:{" "}
                              {getClientName(
                                visit
                              )}
                            </Typography>

                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              {formatVisitTime(
                                visit
                              )}
                            </Typography>

                          </Box>

                          <Chip
                            label={
                              visit.computedStatus
                            }
                            color={
                              visit.computedStatus ===
                              "Overdue"
                                ? "error"
                                : "primary"
                            }
                          />

                        </Stack>

                      </Paper>
                    )
                  )}

                </Stack>
              )}

            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* =====================================================
          ASSIGNED PROPERTIES
      ===================================================== */}

      <Card>
        <CardContent>

          <Stack
            direction={{
              xs: "column",
              sm: "row",
            }}
            justifyContent="space-between"
            alignItems={{
              xs: "flex-start",
              sm: "center",
            }}
            spacing={1}
            sx={{ mb: 2 }}
          >

            <Box>

              <Typography variant="h6">
                Assigned listings
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
              >
                Only properties assigned to
                your account are shown.
              </Typography>

            </Box>

            <Chip
              label={`${properties.length} assigned`}
              color="primary"
              variant="outlined"
            />

          </Stack>

          {/* =================================================
              DATA GRID
          ================================================= */}

          <Box
            sx={{
              width: "100%",
              height: 600,
            }}
          >

            <DataGrid
              rows={properties}
              columns={columns}

              disableRowSelectionOnClick

              hideFooterSelectedRowCount

              /*
               * Server-side modes
               */
              paginationMode="server"
              sortingMode="server"
              filterMode="server"

              /*
               * Pagination
               */
              paginationModel={
                paginationModel
              }

              onPaginationModelChange={
                handlePaginationChange
              }

              /*
               * Sorting
               */
              sortModel={sortModel}

              onSortModelChange={
                handleSortChange
              }

              /*
               * Backend total.
               */
              rowCount={
                realProperties.data
                  ?.total ??
                properties.length
              }

              pageSizeOptions={[
                25,
                50,
                100,
              ]}
            />

          </Box>

        </CardContent>
      </Card>

    </Box>
  );
}