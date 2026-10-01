
import { useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Button,
  Stack,
  Chip,
  TextField,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Snackbar,
  Alert,
} from "@mui/material";
import {
  Add,
  DragIndicator,
  ContentCopy,
} from "@mui/icons-material";
import {
  DataGrid,
  GridColDef,
} from "@mui/x-data-grid";
import { PageHeader } from "./Common";
import {
  useInvitesQuery,
  useMasterDataQuery,
  useUsersQuery,
} from "../app/api";

const usersMock = [
  {
    id: 2,
    name: "Aarav Mehta",
    email: "admin@skyline.dev",
    role: "ADMIN",
    active: true,
  },
  {
    id: 3,
    name: "Neha Kapoor",
    email: "manager@skyline.dev",
    role: "MANAGER",
    active: true,
  },
  {
    id: 4,
    name: "Riya Sharma",
    email: "riya@skyline.dev",
    role: "AGENT",
    active: true,
  },
  {
    id: 5,
    name: "Kabir Singh",
    email: "kabir@skyline.dev",
    role: "AGENT",
    active: true,
  },
];

type Role = "ADMIN" | "MANAGER" | "AGENT";

type Invite = {
  id: number;
  email: string;
  role: Role;
  status?: string;
  expiresAt?: string;
  inviteLink?: string;
};

export function UsersPage() {
  const { data } = useUsersQuery({
    includeInactive: true,
  });

  const { data: inviteData } = useInvitesQuery();

  const [users, setUsers] = useState(usersMock);

  const [invites, setInvites] = useState<Invite[]>(
    inviteData?.data || [
      {
        id: 1,
        email: "newagent@example.com",
        role: "AGENT",
        status: "Pending",
        expiresAt: new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString(),
        inviteLink:
          "http://localhost:5173/register?invite=demo-1",
      },
    ]
  );

  const [inviteOpen, setInviteOpen] = useState(false);

  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("AGENT");

  const [rowErrors, setRowErrors] = useState<
    Record<number, string>
  >({});

  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
  });

  const serverUsers = data?.data;

  const rows = (serverUsers?.length ? serverUsers : users).map(
    (user: any) => ({
      ...user,
      isActive: user.isActive ?? user.active ?? true,
    })
  );

  const showMessage = (message: string) => {
    setSnackbar({
      open: true,
      message,
    });
  };

  const getActiveAdmins = () =>
    users.filter(
      (user) => user.role === "ADMIN" && user.active
    );

  const isLastActiveAdmin = (user: any) =>
    user.role === "ADMIN" &&
    user.active &&
    getActiveAdmins().length === 1;

  const handleInvite = () => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      showMessage("Name and email are required.");
      return;
    }

    const inviteId = Date.now();

    const newInvite: Invite = {
      id: inviteId,
      email: inviteEmail.trim(),
      role: inviteRole,
      status: "Pending",
      expiresAt: new Date(
        Date.now() + 24 * 60 * 60 * 1000
      ).toISOString(),
      inviteLink: `${window.location.origin}/register?invite=${inviteId}`,
    };

    setInvites((current) => [...current, newInvite]);

    setInviteName("");
    setInviteEmail("");
    setInviteRole("AGENT");
    setInviteOpen(false);

    showMessage(
      `Invite created for ${newInvite.email}. Valid for 24 hours.`
    );
  };

  const handleRoleChange = (id: number, role: Role) => {
    const target = users.find((user) => user.id === id);

    if (!target) return;

    /*
     * Business rule:
     * The last active ADMIN cannot be demoted.
     */
    if (
      target.role === "ADMIN" &&
      target.active &&
      role !== "ADMIN" &&
      isLastActiveAdmin(target)
    ) {
      const message =
        "The last active ADMIN cannot be demoted.";

      setRowErrors((current) => ({
        ...current,
        [id]: message,
      }));

      return;
    }

    setRowErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    setUsers((current) =>
      current.map((user) =>
        user.id === id
          ? {
              ...user,
              role,
            }
          : user
      )
    );

    showMessage("User role updated.");
  };

  const handleToggleActive = (id: number) => {
    const target = users.find((user) => user.id === id);

    if (!target) return;

    /*
     * Business rule:
     * The last active ADMIN cannot be deactivated.
     */
    if (isLastActiveAdmin(target)) {
      const message =
        "The last active ADMIN cannot be deactivated.";

      setRowErrors((current) => ({
        ...current,
        [id]: message,
      }));

      return;
    }

    setRowErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    setUsers((current) =>
      current.map((user) =>
        user.id === id
          ? {
              ...user,
              active: !user.active,
            }
          : user
      )
    );

    showMessage(
      target.active
        ? "User deactivated."
        : "User reactivated."
    );
  };

  const copyInvite = async (invite: Invite) => {
    if (!invite.inviteLink) {
      showMessage("Invite link is not available.");
      return;
    }

    try {
      await navigator.clipboard.writeText(
        invite.inviteLink
      );

      showMessage("Invite link copied.");
    } catch {
      showMessage("Unable to copy invite link.");
    }
  };

  const formatExpiry = (expiresAt?: string) => {
    if (!expiresAt) return "24 hours";

    const expiry = new Date(expiresAt);

    if (Number.isNaN(expiry.getTime())) {
      return expiresAt;
    }

    const remaining = expiry.getTime() - Date.now();

    if (remaining <= 0) {
      return "Expired";
    }

    const hours = Math.floor(
      remaining / (1000 * 60 * 60)
    );

    const minutes = Math.floor(
      (remaining % (1000 * 60 * 60)) /
        (1000 * 60)
    );

    if (hours > 0) {
      return `${hours}h ${minutes}m left`;
    }

    return `${Math.max(minutes, 1)}m left`;
  };

  const getRoleDescription = (role: Role) => {
    switch (role) {
      case "ADMIN":
        return "Tenant administrator with access to user administration and tenant settings.";

      case "MANAGER":
        return "Manages team activity, properties and operational workflows.";

      case "AGENT":
        return "Works with assigned properties and day-to-day property tasks.";

      default:
        return "";
    }
  };

  const cols: GridColDef[] = [
    {
      field: "name",
      headerName: "Name",
      flex: 1,
      minWidth: 150,
    },
    {
      field: "email",
      headerName: "Email",
      flex: 1,
      minWidth: 210,
    },
    {
      field: "role",
      headerName: "Role",
      width: 170,
      renderCell: (params) => (
        <FormControl size="small" fullWidth>
          <Select
            value={params.row.role}
            onChange={(event) =>
              handleRoleChange(
                params.row.id,
                event.target.value as Role
              )
            }
          >
            <MenuItem value="ADMIN">
              ADMIN
            </MenuItem>

            <MenuItem value="MANAGER">
              MANAGER
            </MenuItem>

            <MenuItem value="AGENT">
              AGENT
            </MenuItem>
          </Select>
        </FormControl>
      ),
    },
    {
      field: "isActive",
      headerName: "Status",
      width: 120,
      renderCell: (params) => (
        <Chip
          size="small"
          color={
            params.value === false
              ? "default"
              : "success"
          }
          label={
            params.value === false
              ? "Inactive"
              : "Active"
          }
        />
      ),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 150,
      sortable: false,
      renderCell: (params) => (
        <Button
          size="small"
          variant="outlined"
          onClick={() =>
            handleToggleActive(params.row.id)
          }
        >
          {params.row.isActive
            ? "Deactivate"
            : "Activate"}
        </Button>
      ),
    },
  ];

  return (
    <Box className="page">
      <PageHeader
        title="Users & invites"
        subtitle="Admin-only tenant user administration"
        action={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setInviteOpen(true)}
          >
            Invite user
          </Button>
        }
      />

      <Grid container spacing={2}>
        <Grid item xs={12} lg={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 0.5 }}>
                Team
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 2 }}
              >
                Manage roles and account access.
                The last active ADMIN cannot be
                demoted or deactivated.
              </Typography>

              <Box sx={{ height: 500, width: "100%" }}>
                <DataGrid
                  rows={rows}
                  columns={cols}
                  disableRowSelectionOnClick
                  pageSizeOptions={[5, 10, 25]}
                  initialState={{
                    pagination: {
                      paginationModel: {
                        pageSize: 10,
                        page: 0,
                      },
                    },
                  }}
                />
              </Box>

              {Object.entries(rowErrors).map(
                ([id, message]) => (
                  <Alert
                    key={id}
                    severity="error"
                    sx={{ mt: 1 }}
                    onClose={() =>
                      setRowErrors((current) => {
                        const next = { ...current };
                        delete next[Number(id)];
                        return next;
                      })
                    }
                  >
                    {message}
                  </Alert>
                )
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={4}>
          <InvitePanel
            invites={invites}
            onCopy={copyInvite}
            formatExpiry={formatExpiry}
          />
        </Grid>
      </Grid>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          Invite a user
        </DialogTitle>

        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <Alert severity="info">
              Invite links are single-use and expire
              after 24 hours.
            </Alert>

            <TextField
              label="Full name"
              value={inviteName}
              onChange={(event) =>
                setInviteName(event.target.value)
              }
              fullWidth
            />

            <TextField
              label="Email address"
              type="email"
              value={inviteEmail}
              onChange={(event) =>
                setInviteEmail(event.target.value)
              }
              fullWidth
            />

            <FormControl fullWidth>
              <InputLabel>Role</InputLabel>

              <Select
                value={inviteRole}
                label="Role"
                onChange={(event) =>
                  setInviteRole(
                    event.target.value as Role
                  )
                }
              >
                <MenuItem value="ADMIN">
                  ADMIN
                </MenuItem>

                <MenuItem value="MANAGER">
                  MANAGER
                </MenuItem>

                <MenuItem value="AGENT">
                  AGENT
                </MenuItem>
              </Select>
            </FormControl>

            <Card
              variant="outlined"
              sx={{
                backgroundColor: "rgba(255,255,255,0.03)",
              }}
            >
              <CardContent>
                <Typography
                  variant="subtitle2"
                  sx={{ mb: 0.5 }}
                >
                  {inviteRole}
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  {getRoleDescription(inviteRole)}
                </Typography>
              </CardContent>
            </Card>
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => setInviteOpen(false)}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={handleInvite}
          >
            Send invite
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() =>
          setSnackbar((current) => ({
            ...current,
            open: false,
          }))
        }
      >
        <Alert
          severity="success"
          onClose={() =>
            setSnackbar((current) => ({
              ...current,
              open: false,
            }))
          }
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function InvitePanel({
  invites,
  onCopy,
  formatExpiry,
}: {
  invites: Invite[];
  onCopy: (invite: Invite) => void;
  formatExpiry: (expiresAt?: string) => string;
}) {
  const pendingInvites = invites.filter(
    (invite) => invite.status !== "ACCEPTED"
  );

  return (
    <Card>
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 2 }}
        >
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Pending Invites
            </Typography>

            <Typography variant="body2" color="text.secondary">
              {pendingInvites.length} pending invite
              {pendingInvites.length === 1 ? "" : "s"}
            </Typography>
          </Box>

          <Chip
            label={`${pendingInvites.length} Pending`}
            color={pendingInvites.length > 0 ? "warning" : "default"}
            size="small"
          />
        </Stack>

        <Alert severity="info" sx={{ mb: 2 }}>
          Invite links are single-use and expire after 24 hours.
        </Alert>

        {pendingInvites.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No pending invites.
          </Typography>
        ) : (
          <List disablePadding>
            {pendingInvites.map((invite) => {
              const isExpired =
                !!invite.expiresAt &&
                new Date(invite.expiresAt).getTime() <= Date.now();

              return (
                <ListItem
                  key={invite.id}
                  disableGutters
                  sx={{
                    mb: 1.5,
                    p: 1.5,
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 2,
                    alignItems: "flex-start",
                  }}
                >
                  <ListItemText
                    primary={
                      <Typography
                        variant="body1"
                        fontWeight={600}
                        component="div"
                      >
                        {invite.email}
                      </Typography>
                    }
                    secondary={
                      <Box sx={{ mt: 0.75 }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          useFlexGap
                          flexWrap="wrap"
                        >
                          <Chip
                            label={invite.role}
                            size="small"
                            variant="outlined"
                          />

                          <Chip
                            label={invite.status ?? "PENDING"}
                            size="small"
                            color={
                              isExpired
                                ? "error"
                                : invite.status === "ACCEPTED"
                                  ? "success"
                                  : "warning"
                            }
                          />

                          <Chip
                            label={
                              invite.expiresAt
                                ? formatExpiry(invite.expiresAt)
                                : "Expires in 24 hours"
                            }
                            size="small"
                            color={isExpired ? "error" : "default"}
                          />
                        </Stack>
                      </Box>
                    }
                    secondaryTypographyProps={{
                      component: "div",
                    }}
                  />

                  <IconButton
                    edge="end"
                    aria-label="copy invite link"
                    onClick={() => onCopy(invite)}
                    disabled={isExpired || !invite.inviteLink}
                    sx={{ ml: 1 }}
                  >
                    <ContentCopy fontSize="small" />
                  </IconButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </CardContent>
    </Card>
  );
}

export function MasterDataPage() {
  const { data } = useMasterDataQuery();

  const [tab, setTab] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [newItem, setNewItem] = useState("");

 const [customItems, setCustomItems] = useState<
  Record<number, string[]>
>({});

const [orderedItems, setOrderedItems] = useState<
  Record<number, string[]>
>({});

  const [inactiveItems, setInactiveItems] = useState<
    Record<number, string[]>
  >({});

  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
  });

  const names = [
    "Statuses",
    "Property types",
    "Localities",
    "Amenities",
  ];

  const fallback: string[][] = [
    [
      "Draft",
      "Listed",
      "Site Visit",
      "Negotiation",
      "Closed",
      "Withdrawn",
    ],
    [
      "Apartment",
      "Villa",
      "Plot",
      "Commercial",
    ],
    [
      "Bandra West",
      "Andheri East",
      "Gurugram",
      "Kankarbagh",
    ],
    [
      "Lift",
      "Parking",
      "Power Backup",
      "Gym",
      "Swimming Pool",
      "Security",
    ],
  ];

  const getApiItems = () => {
    if (!data) return [];

    const keys = Object.keys(data);
    const key = keys[tab];

    const apiItems = key ? data[key] : [];

    if (!Array.isArray(apiItems)) return [];

    return apiItems.map((item: any) =>
      typeof item === "string"
        ? item
        : item.name || String(item.id)
    );
  };

  const apiItems = getApiItems();

  const baseItems =
    apiItems.length > 0 ? apiItems : fallback[tab];

  const items =
  orderedItems[tab] ||
  [...baseItems, ...(customItems[tab] || [])];

  const inactive = inactiveItems[tab] || [];

  const visibleItems = items.filter(
    (item) => !inactive.includes(item)
  );

  const openAddDialog = () => {
    setNewItem("");
    setAddOpen(true);
  };

  const handleAddItem = () => {
    const value = newItem.trim();

    if (!value) {
      setSnackbar({
        open: true,
        message: "Please enter an item name.",
      });
      return;
    }

    if (items.some((item) => item.toLowerCase() === value.toLowerCase())) {
      setSnackbar({
        open: true,
        message: "This item already exists.",
      });
      return;
    }

    const updatedItems = [...items, value];

setOrderedItems((current) => ({
  ...current,
  [tab]: updatedItems,
}));

    setNewItem("");
    setAddOpen(false);

    setSnackbar({
      open: true,
      message: `${value} added successfully.`,
    });
  };

  const handleDeactivate = (item: string) => {
    // Terminal status protection
    if (
      tab === 0 &&
      ["Closed", "Withdrawn"].includes(item)
    ) {
      setSnackbar({
        open: true,
        message: `${item} is a terminal stage and cannot be deactivated.`,
      });
      return;
    }

    setInactiveItems((current) => ({
      ...current,
      [tab]: [...(current[tab] || []), item],
    }));

    setSnackbar({
      open: true,
      message: `${item} deactivated.`,
    });
  };

  const handleReactivate = (item: string) => {
    setInactiveItems((current) => ({
      ...current,
      [tab]: (current[tab] || []).filter(
        (value) => value !== item
      ),
    }));

    setSnackbar({
      open: true,
      message: `${item} reactivated.`,
    });
  };
const moveItem = (
  currentIndex: number,
  direction: "up" | "down"
) => {
  const currentItems = [...items];

  const targetIndex =
    direction === "up"
      ? currentIndex - 1
      : currentIndex + 1;

  if (
    targetIndex < 0 ||
    targetIndex >= currentItems.length
  ) {
    return;
  }

  [currentItems[currentIndex], currentItems[targetIndex]] = [
    currentItems[targetIndex],
    currentItems[currentIndex],
  ];

  setOrderedItems((current) => ({
    ...current,
    [tab]: currentItems,
  }));

  setSnackbar({
    open: true,
    message: "Order updated.",
  });
};

  return (
    <Box className="page">
      <PageHeader
        title="Master data"
        subtitle="Manage tenant statuses, property types, localities and amenities"
        action={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={openAddDialog}
          >
            Add item
          </Button>
        }
      />

      <Card>
        <CardContent>
          <Tabs
            value={tab}
            onChange={(_, value) => setTab(value)}
            variant="scrollable"
            sx={{ mb: 2 }}
          >
            {names.map((name) => (
              <Tab key={name} label={name} />
            ))}
          </Tabs>

          {visibleItems.length === 0 ? (
            <Box sx={{ py: 5, textAlign: "center" }}>
              <Typography
                variant="body1"
                color="text.secondary"
              >
                No active items.
              </Typography>
            </Box>
          ) : (
            <List>
              {visibleItems.map((item, index) => (
                <ListItem
                  key={`${item}-${index}`}
                  divider
                  secondaryAction={
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                    >
                      <IconButton
                        size="small"
                        disabled={index === 0}
                        onClick={() =>
                          moveItem(index, "up")
                        }
                        aria-label="Move item up"
                      >
                        ↑
                      </IconButton>

                      <IconButton
                        size="small"
                        disabled={
                          index === visibleItems.length - 1
                        }
                        onClick={() =>
                          moveItem(index, "down")
                        }
                        aria-label="Move item down"
                      >
                        ↓
                      </IconButton>

                      <Chip
                        size="small"
                        label="Active"
                        color="success"
                      />

                      <Button
                        size="small"
                        color="error"
                        onClick={() =>
                          handleDeactivate(item)
                        }
                      >
                        Deactivate
                      </Button>
                    </Stack>
                  }
                >
                  <DragIndicator
                    sx={{
                      mr: 2,
                      color: "text.disabled",
                    }}
                  />

                  <ListItemText
                    primary={item}
                    secondary={
                      tab === 0 &&
                      ["Closed", "Withdrawn"].includes(item)
                        ? "Terminal stage"
                        : "Active master-data item"
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}

          {inactive.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography
                variant="subtitle2"
                sx={{ mb: 1 }}
              >
                Inactive items
              </Typography>

              <List>
                {inactive.map((item) => (
                  <ListItem
                    key={item}
                    divider
                    secondaryAction={
                      <Button
                        size="small"
                        onClick={() =>
                          handleReactivate(item)
                        }
                      >
                        Reactivate
                      </Button>
                    }
                  >
                    <ListItemText
                      primary={item}
                      secondary="Inactive"
                    />

                    <Chip
                      size="small"
                      label="Inactive"
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          Add {names[tab].slice(0, -1)}
        </DialogTitle>

        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label={`${names[tab].slice(0, -1)} name`}
            value={newItem}
            onChange={(event) =>
              setNewItem(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleAddItem();
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={handleAddItem}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() =>
          setSnackbar((current) => ({
            ...current,
            open: false,
          }))
        }
      >
        <Alert severity="success">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

