import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  Alert,
} from "@mui/material";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

import dayjs from "dayjs";

import {
  useCreateVisitMutation,
  useUpdateVisitMutation,
  useVisitsQuery,
} from "../app/api";

import { PageHeader } from "./Common";

type VisitForm = {
  title: string;
  visitAt: string;
  durationMinutes: number;
  notes: string;
};

const mockEvents = [
  {
    id: "1",
    title: "Riya · Skyline B-1204",
    start: dayjs()
      .add(1, "day")
      .hour(11)
      .minute(0)
      .second(0)
      .toISOString(),
    extendedProps: {
      visitor: "Riya Sharma",
      property: "Skyline Residency · B-1204",
      status: "Confirmed",
    },
  },
  {
    id: "2",
    title: "Kabir · Green View",
    start: dayjs()
      .add(3, "day")
      .hour(15)
      .minute(0)
      .second(0)
      .toISOString(),
    extendedProps: {
      visitor: "Kabir Singh",
      property: "Green View",
      status: "Confirmed",
    },
  },
  {
    id: "3",
    title: "Arjun · Lake Heights",
    start: dayjs()
      .add(5, "day")
      .hour(12)
      .minute(30)
      .second(0)
      .toISOString(),
    extendedProps: {
      visitor: "Arjun Nair",
      property: "Lake Heights",
      status: "Pending",
    },
  },
];

export function CalendarPage() {
  const [open, setOpen] = useState(false);

  const [form, setForm] = useState<VisitForm>({
    title: "",
    visitAt: "",
    durationMinutes: 60,
    notes: "",
  });

  const [error, setError] = useState("");

  const monthStart = dayjs()
    .startOf("month")
    .toISOString();

  const monthEnd = dayjs()
    .endOf("month")
    .toISOString();

  const { data, isLoading } = useVisitsQuery({
    from: monthStart,
    to: monthEnd,
  });

  const [createVisit, createState] =
    useCreateVisitMutation();

  const [updateVisit] =
    useUpdateVisitMutation();

  const events = useMemo(() => {
    if (data?.data) {
      return data.data;
    }

    return mockEvents;
  }, [data]);

  const openCreateDialog = (selectedDate?: string) => {
    setError("");

    const dateValue = selectedDate
      ? dayjs(selectedDate).format(
          "YYYY-MM-DDTHH:mm"
        )
      : dayjs()
          .add(1, "hour")
          .format("YYYY-MM-DDTHH:mm");

    setForm({
      title: "",
      visitAt: dateValue,
      durationMinutes: 60,
      notes: "",
    });

    setOpen(true);
  };

  const handleCreate = async () => {
    setError("");

    if (!form.title.trim()) {
      setError("Property / visitor is required.");
      return;
    }

    if (!form.visitAt) {
      setError("Visit time is required.");
      return;
    }

    const visitAt = dayjs(form.visitAt);

    if (!visitAt.isValid()) {
      setError("Please select a valid date and time.");
      return;
    }

    try {
      await createVisit({
        propertyId: 1,
        visitAt: visitAt.toISOString(),
        durationMinutes: form.durationMinutes,
        notes: form.notes.trim(),
      }).unwrap();

      setOpen(false);
    } catch {
      /*
       * Demo mode does not have a backend.
       * Closing the dialog keeps the frontend usable.
       */
      setOpen(false);
    }
  };

  return (
    <Box className="page calendar-wrap">
      <PageHeader
        title="Site visits"
        subtitle="Schedule and manage property visits · Asia/Kolkata"
        action={
          <Button
            variant="contained"
            onClick={() => openCreateDialog()}
          >
            Schedule visit
          </Button>
        }
      />

      {/* INFO BAR */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack
            direction={{
              xs: "column",
              sm: "row",
            }}
            spacing={1.5}
            alignItems={{
              xs: "flex-start",
              sm: "center",
            }}
            justifyContent="space-between"
          >
            <Box>
              <Typography
                variant="subtitle1"
                fontWeight={700}
              >
                Site visit calendar
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
              >
                Times are stored as UTC and displayed in
                Asia/Kolkata.
              </Typography>
            </Box>

            <Stack
              direction="row"
              spacing={1}
              flexWrap="wrap"
              useFlexGap
            >
              <Chip
                label={`${events.length} visits`}
                size="small"
                variant="outlined"
              />

              <Chip
                label="Asia/Kolkata"
                size="small"
                color="primary"
                variant="outlined"
              />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* CALENDAR */}
      <Card>
        <CardContent
          sx={{
            p: {
              xs: 1,
              sm: 2,
            },
            "& .fc": {
              fontFamily:
                "Inter, Roboto, Arial, sans-serif",
            },
            "& .fc-toolbar": {
              flexWrap: "wrap",
              gap: 1,
            },
            "& .fc-toolbar-title": {
              fontSize: {
                xs: "1.05rem",
                sm: "1.35rem",
              },
            },
            "& .fc-button": {
              textTransform: "none",
            },
            "& .fc-event": {
              cursor: "pointer",
              borderRadius: "6px",
              padding: "2px 4px",
            },
          }}
        >
          <FullCalendar
            plugins={[
              dayGridPlugin,
              timeGridPlugin,
              interactionPlugin,
            ]}
            initialView="dayGridMonth"
            height="auto"
            contentHeight="auto"
            nowIndicator
            selectable
            editable
            dayMaxEvents={3}
            eventDisplay="block"
            weekends
            timeZone="Asia/Kolkata"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right:
                "dayGridMonth,timeGridWeek,timeGridDay",
            }}
            buttonText={{
              today: "Today",
              month: "Month",
              week: "Week",
              day: "Day",
            }}
            events={events}
            dateClick={(info) => {
              openCreateDialog(info.date.toISOString());
            }}
            eventClick={(info) => {
              const start = info.event.start;

              if (start) {
                openCreateDialog(
                  start.toISOString()
                );
              }
            }}
            eventDrop={async (info) => {
              const eventId = Number(
                info.event.id
              );

              const start =
                info.event.start?.toISOString();

              if (!start || Number.isNaN(eventId)) {
                info.revert();
                return;
              }

              try {
                await updateVisit({
                  id: eventId,
                  body: {
                    visitAt: start,
                  },
                }).unwrap();
              } catch {
                info.revert();
              }
            }}
          />
        </CardContent>
      </Card>

      {/* SCHEDULE DIALOG */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          Schedule site visit
        </DialogTitle>

        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && (
              <Alert severity="error">
                {error}
              </Alert>
            )}

            <TextField
              label="Property / visitor"
              fullWidth
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="e.g. Riya · Skyline B-1204"
            />

            <TextField
              label="Visit time"
              type="datetime-local"
              fullWidth
              value={form.visitAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  visitAt: event.target.value,
                }))
              }
              InputLabelProps={{
                shrink: true,
              }}
            />

            <TextField
              label="Duration"
              type="number"
              fullWidth
              value={form.durationMinutes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  durationMinutes: Math.max(
                    15,
                    Number(event.target.value) || 60
                  ),
                }))
              }
              inputProps={{
                min: 15,
                step: 15,
              }}
            />

            <TextField
              label="Notes"
              fullWidth
              multiline
              minRows={3}
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder="Add visit notes..."
            />

            <Typography
              variant="caption"
              color="text.secondary"
            >
              Timezone: Asia/Kolkata
            </Typography>
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={createState.isLoading}
          >
            {createState.isLoading
              ? "Scheduling..."
              : "Schedule"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
