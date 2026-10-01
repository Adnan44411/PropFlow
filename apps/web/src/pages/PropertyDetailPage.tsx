import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";

import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  IconButton,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";

import {
  ArrowBack,
  CheckCircle,
  DoneAll,
  ErrorOutline,
  Refresh,
  Send,
} from "@mui/icons-material";

import type { RootState } from "../app/store";
import { usePropertyQuery } from "../app/api";
import { PageHeader } from "./Common";

function money(value: number) {
  if (value >= 10000000) {
    return `₹${(value / 10000000).toFixed(2)} Cr`;
  }

  if (value >= 100000) {
    return `₹${(value / 100000).toFixed(2)} Lakh`;
  }

  return `₹${value.toLocaleString("en-IN")}`;
}

function priceChange(current: number, original: number) {
  if (!original) return "—";

  const percentage = ((current - original) / original) * 100;

  if (percentage === 0) return "No change";

  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(1)}% since listing`;
}

/*
 * Backend can return some fields either as:
 *
 * "SALE"
 *
 * or:
 *
 * {
 *   id: 1,
 *   name: "SALE"
 * }
 *
 * This type handles both cases.
 */
type NamedOption = {
  id: number | string;
  name: string;
};

type MessageStatus = "sent" | "sending" | "failed";

type Message = {
  clientMsgId: string;
  name: string;
  body: string;
  time: string;
  status: MessageStatus;
  mine?: boolean;
};

type PropertyStatus = {
  id: number | string;
  name: string;
  stage: string;
  isTerminal: boolean;
  sortOrder: number;
};

type PropertyData = {
  id: number;
  title: string;

  status: string | PropertyStatus | NamedOption;

  type: string | NamedOption;

  listingType: string | NamedOption;

  bhk: number;

  priceInr: number;

  originalPriceInr: number;

  carpetAreaSqft: number;

  buildingName: string;

  unitNo: string;

  locality: string;

  city: string;

  ownerName: string;

  ownerPhone: string;

  assignee: string | NamedOption;

  amenities: Array<string | NamedOption>;
};

const DEMO_PROPERTY: PropertyData = {
  id: 1,
  title: "Modern 3BHK in Skyline",
  status: "Listed",
  type: "Apartment",
  listingType: "SALE",
  bhk: 3,
  priceInr: 12500000,
  originalPriceInr: 13000000,
  carpetAreaSqft: 1450,
  buildingName: "Skyline Residency",
  unitNo: "B-1204",
  locality: "Bandra West",
  city: "Mumbai",
  ownerName: "Rajesh Kumar",
  ownerPhone: "98300 •••21",
  assignee: "Riya Sharma",
  amenities: [
    "Swimming Pool",
    "Gym",
    "Parking",
    "Power Backup",
    "Security",
    "Club House",
  ],
};

const STEPS = [
  "Draft",
  "Listed",
  "Site Visit",
  "Negotiation",
  "Closed",
];

/*
 * Safely converts API values into text.
 *
 * Examples:
 *
 * "SALE" -> "SALE"
 *
 * { id: 1, name: "SALE" } -> "SALE"
 *
 * null/undefined -> "Unknown"
 */
function displayName(
  value:
    | string
    | number
    | NamedOption
    | PropertyStatus
    | null
    | undefined
) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (value && typeof value === "object") {
    return value.name ?? "Unknown";
  }

  return "Unknown";
}

function createClientMessageId() {
  return `client-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function PropertyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { user, demo } = useSelector(
    (state: RootState) => state.auth
  );

  const real = usePropertyQuery(Number(id), {
    skip: demo || !id,
  });

  const p: PropertyData = real.data || {
    ...DEMO_PROPERTY,
    id: Number(id),
  };

  /*
   * Normalize API values before rendering.
   */
  const statusName = displayName(p.status);

  const propertyTypeName = displayName(p.type);

  const listingTypeName = displayName(p.listingType);

  const assigneeName = displayName(p.assignee);

  const pricePerSqft = useMemo(() => {
    if (!p.carpetAreaSqft) return 0;

    return Math.round(p.priceInr / p.carpetAreaSqft);
  }, [p.priceInr, p.carpetAreaSqft]);

  const currentStep = Math.max(
    0,
    STEPS.findIndex(
      (step) =>
        step.toLowerCase() === statusName.toLowerCase()
    )
  );

  const [msg, setMsg] = useState("");

  const [messages, setMessages] = useState<Message[]>([
    {
      clientMsgId: "server-1",
      name: "Riya Sharma",
      body: "Buyer confirmed Saturday 11 AM site visit.",
      time: "10:24 AM",
      status: "sent",
    },
    {
      clientMsgId: "server-2",
      name: "Kabir Singh",
      body: "I updated the price discussion notes.",
      time: "10:31 AM",
      status: "sent",
    },
  ]);

  const [typing, setTyping] = useState(false);

  const [online] = useState(true);

  const sendMessage = () => {
    const text = msg.trim();

    if (!text) return;

    const clientMsgId = createClientMessageId();

    const newMessage: Message = {
      clientMsgId,
      name: user?.name || "You",
      body: text,
      time: "Sending...",
      status: "sending",
      mine: true,
    };

    setMessages((current) => [
      ...current,
      newMessage,
    ]);

    setMsg("");

    setTimeout(() => {
      setMessages((current) =>
        current.map((message) =>
          message.clientMsgId === clientMsgId
            ? {
                ...message,
                status: "sent",
                time: "Just now",
              }
            : message
        )
      );
    }, 700);
  };

  const retryMessage = (clientMsgId: string) => {
    setMessages((current) =>
      current.map((message) =>
        message.clientMsgId === clientMsgId
          ? {
              ...message,
              status: "sending",
              time: "Sending...",
            }
          : message
      )
    );

    setTimeout(() => {
      setMessages((current) =>
        current.map((message) =>
          message.clientMsgId === clientMsgId
            ? {
                ...message,
                status: "sent",
                time: "Just now",
              }
            : message
        )
      );
    }, 700);
  };

  const simulateFailedMessage = () => {
    const clientMsgId = createClientMessageId();

    setMessages((current) => [
      ...current,
      {
        clientMsgId,
        name: user?.name || "You",
        body: "Message failed to send.",
        time: "Failed",
        status: "failed",
        mine: true,
      },
    ]);
  };

  return (
    <Box className="page">
      <PageHeader
        title={p.title}
        subtitle={`${p.buildingName} · ${p.unitNo}`}
        action={
          <Button
            startIcon={<ArrowBack />}
            onClick={() => navigate("/properties")}
          >
            Back
          </Button>
        }
      />

      <Grid container spacing={2.5}>
        {/* LEFT SIDE */}
        <Grid item xs={12} lg={8}>
          <Stack spacing={2.5}>
            {/* PRICE CARD */}
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
                >
                  <Box>
                    <Typography variant="h4">
                      {money(p.priceInr)}
                    </Typography>

                    <Typography
                      variant="body1"
                      color="text.secondary"
                    >
                      {p.carpetAreaSqft.toLocaleString(
                        "en-IN"
                      )}{" "}
                      sqft
                      {" · "}
                      ₹
                      {pricePerSqft.toLocaleString(
                        "en-IN"
                      )}
                      /sqft
                    </Typography>

                    <Typography
                      variant="body2"
                      color={
                        p.priceInr < p.originalPriceInr
                          ? "success.main"
                          : "text.secondary"
                      }
                      sx={{ mt: 0.5 }}
                    >
                      {priceChange(
                        p.priceInr,
                        p.originalPriceInr
                      )}
                    </Typography>
                  </Box>

                  <Stack
                    direction="row"
                    spacing={1}
                    flexWrap="wrap"
                  >
                    <Chip
                      label={statusName || "Unknown"}
                      color="primary"
                      variant="outlined"
                    />

                    <Chip
                      label={
                        listingTypeName || "Unknown"
                      }
                      variant="outlined"
                    />
                  </Stack>
                </Stack>

                <Stepper
                  activeStep={currentStep}
                  sx={{
                    mt: 4,
                    overflowX: "auto",
                    pb: 1,
                  }}
                >
                  {STEPS.map((status) => (
                    <Step key={status}>
                      <StepLabel>
                        {status}
                      </StepLabel>
                    </Step>
                  ))}
                </Stepper>
              </CardContent>
            </Card>

            {/* KEY FACTS */}
            <Card>
              <CardContent>
                <Typography
                  variant="h6"
                  sx={{ mb: 2 }}
                >
                  Key facts
                </Typography>

                <Grid container spacing={2}>
                  {[
                    [
                      "Property type",
                      propertyTypeName,
                    ],
                    [
                      "Listing",
                      listingTypeName,
                    ],
                    ["BHK", p.bhk],
                    [
                      "Carpet area",
                      `${p.carpetAreaSqft} sqft`,
                    ],
                    [
                      "Building",
                      p.buildingName,
                    ],
                    ["Unit", p.unitNo],
                    ["Locality", p.locality],
                    ["City", p.city],
                    [
                      "Owner",
                      p.ownerName,
                    ],
                    [
                      "Owner phone",
                      p.ownerPhone,
                    ],
                    [
                      "Assigned agent",
                      assigneeName,
                    ],
                  ].map(
                    ([label, value]) => (
                      <Grid
                        item
                        xs={12}
                        sm={6}
                        key={String(label)}
                      >
                        <Paper
                          variant="outlined"
                          sx={{
                            p: 2,
                            height: "100%",
                          }}
                        >
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            {String(label)}
                          </Typography>

                          <Typography
                            fontWeight={700}
                            sx={{ mt: 0.3 }}
                          >
                            {String(value)}
                          </Typography>
                        </Paper>
                      </Grid>
                    )
                  )}
                </Grid>
              </CardContent>
            </Card>

            {/* AMENITIES */}
            <Card>
              <CardContent>
                <Typography
                  variant="h6"
                  sx={{ mb: 2 }}
                >
                  Amenities
                </Typography>

                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  flexWrap="wrap"
                >
                  {p.amenities.map(
                    (amenity, index) => {
                      const amenityName =
                        displayName(amenity);

                      /*
                       * IMPORTANT:
                       * Never use an object directly as a React key.
                       */
                      const amenityKey =
                        typeof amenity ===
                        "object" &&
                        amenity !== null
                          ? `amenity-${amenity.id}`
                          : `amenity-${String(
                              amenity
                            )}-${index}`;

                      return (
                        <Chip
                          key={amenityKey}
                          label={amenityName}
                          variant="outlined"
                          icon={
                            <CheckCircle />
                          }
                        />
                      );
                    }
                  )}
                </Stack>
              </CardContent>
            </Card>

            {/* ACTIVITY */}
            <Card>
              <CardContent>
                <Typography
                  variant="h6"
                  sx={{ mb: 2 }}
                >
                  Activity timeline
                </Typography>

                <Stack spacing={2}>
                  {[
                    {
                      title:
                        "Status changed to Listed",
                      time:
                        "Today · 10:20 AM",
                    },
                    {
                      title: `Price updated to ${money(
                        p.priceInr
                      )}`,
                      time:
                        "Today · 10:26 AM",
                    },
                    {
                      title: `Assigned to ${assigneeName}`,
                      time:
                        "Today · 10:31 AM",
                    },
                    {
                      title:
                        "Site visit scheduled",
                      time:
                        "Today · 10:45 AM",
                    },
                  ].map(
                    (activity, index) => (
                      <Stack
                        key={`${activity.title}-${index}`}
                        direction="row"
                        spacing={2}
                        alignItems="flex-start"
                      >
                        <Chip
                          label={index + 1}
                          size="small"
                          color={
                            index === 0
                              ? "primary"
                              : "default"
                          }
                        />

                        <Box>
                          <Typography fontWeight={600}>
                            {activity.title}
                          </Typography>

                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            {activity.time}
                          </Typography>
                        </Box>
                      </Stack>
                    )
                  )}
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        {/* RIGHT SIDE - CHAT */}
        <Grid item xs={12} lg={4}>
          <Card
            sx={{
              height: "100%",
            }}
          >
            <CardContent
              sx={{
                display: "flex",
                flexDirection: "column",
                minHeight: {
                  xs: 500,
                  lg: 700,
                },
              }}
            >
              {/* CHAT HEADER */}
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Box>
                  <Typography variant="h6">
                    Live chat
                  </Typography>

                  <Stack
                    direction="row"
                    spacing={0.7}
                    alignItems="center"
                  >
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: online
                          ? "success.main"
                          : "grey.400",
                      }}
                    />

                    <Typography
                      variant="body2"
                      color="text.secondary"
                    >
                      {online
                        ? "Online"
                        : "Offline"}
                    </Typography>
                  </Stack>
                </Box>

                <Chip
                  size="small"
                  label="Socket ready"
                  variant="outlined"
                />
              </Stack>

              <Divider sx={{ my: 2 }} />

              {/* CHAT MESSAGES */}
              <Box
                className="chat-scroll"
                sx={{
                  flex: 1,
                  overflowY: "auto",
                  mb: 2,
                  pr: 0.5,
                }}
              >
                {messages.map(
                  (message) => (
                    <Box
                      key={
                        message.clientMsgId
                      }
                      sx={{
                        mb: 2,
                        display: "flex",
                        gap: 1,
                        justifyContent:
                          message.mine
                            ? "flex-end"
                            : "flex-start",
                      }}
                    >
                      {!message.mine && (
                        <Avatar
                          sx={{
                            width: 32,
                            height: 32,
                          }}
                        >
                          {message.name.charAt(
                            0
                          )}
                        </Avatar>
                      )}

                      <Box
                        sx={{
                          maxWidth: "85%",
                          bgcolor:
                            message.mine
                              ? "primary.main"
                              : "grey.100",
                          color:
                            message.mine
                              ? "primary.contrastText"
                              : "text.primary",
                          borderRadius: 2,
                          p: 1.3,
                        }}
                      >
                        <Typography
                          variant="caption"
                          fontWeight={700}
                          sx={{
                            display: "block",
                            mb: 0.3,
                          }}
                        >
                          {message.name}
                        </Typography>

                        <Typography>
                          {message.body}
                        </Typography>

                        <Stack
                          direction="row"
                          spacing={0.5}
                          justifyContent="flex-end"
                          alignItems="center"
                          sx={{ mt: 0.5 }}
                        >
                          {message.status ===
                            "sending" && (
                            <Typography
                              variant="caption"
                              sx={{
                                opacity: 0.8,
                              }}
                            >
                              Sending...
                            </Typography>
                          )}

                          {message.status ===
                            "sent" && (
                            <>
                              <Typography
                                variant="caption"
                                sx={{
                                  opacity: 0.75,
                                }}
                              >
                                {
                                  message.time
                                }
                              </Typography>

                              {message.mine && (
                                <DoneAll
                                  sx={{
                                    fontSize: 15,
                                    opacity: 0.8,
                                  }}
                                />
                              )}
                            </>
                          )}

                          {message.status ===
                            "failed" && (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              alignItems="center"
                            >
                              <ErrorOutline
                                sx={{
                                  fontSize: 15,
                                }}
                              />

                              <Typography variant="caption">
                                Failed
                              </Typography>

                              <Button
                                size="small"
                                color="inherit"
                                startIcon={
                                  <Refresh />
                                }
                                onClick={() =>
                                  retryMessage(
                                    message.clientMsgId
                                  )
                                }
                                sx={{
                                  minWidth: 0,
                                  ml: 0.5,
                                }}
                              >
                                Retry
                              </Button>
                            </Stack>
                          )}
                        </Stack>
                      </Box>
                    </Box>
                  )
                )}

                {/* TYPING INDICATOR */}
                {typing && (
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ mb: 2 }}
                  >
                    <Avatar
                      sx={{
                        width: 30,
                        height: 30,
                      }}
                    >
                      R
                    </Avatar>

                    <Paper
                      variant="outlined"
                      sx={{
                        px: 1.5,
                        py: 1,
                        borderRadius: 2,
                      }}
                    >
                      <Typography
                        variant="caption"
                        color="text.secondary"
                      >
                        Riya is typing...
                      </Typography>
                    </Paper>
                  </Stack>
                )}
              </Box>

              {/* DEMO FAILURE TEST */}
              <Button
                size="small"
                color="inherit"
                startIcon={
                  <ErrorOutline />
                }
                onClick={
                  simulateFailedMessage
                }
                sx={{
                  alignSelf:
                    "flex-start",
                  mb: 1,
                }}
              >
                Test failed message
              </Button>

              {/* INPUT */}
              <Stack
                direction="row"
                spacing={1}
                alignItems="flex-end"
              >
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Write a message..."
                  value={msg}
                  multiline
                  maxRows={3}
                  onChange={(event) => {
                    setMsg(
                      event.target.value
                    );

                    setTyping(
                      event.target.value
                        .length > 0
                    );
                  }}
                  onBlur={() =>
                    setTyping(false)
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key ===
                        "Enter" &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();
                      setTyping(false);
                      sendMessage();
                    }
                  }}
                />

                <IconButton
                  color="primary"
                  onClick={sendMessage}
                  disabled={!msg.trim()}
                  sx={{
                    mb: 0.2,
                  }}
                >
                  <Send />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}