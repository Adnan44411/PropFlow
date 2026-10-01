import { useMemo, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Grid,
  Skeleton,
  Stack,
  TextField,
  Typography,
  Chip,
} from "@mui/material";
import Chart from "react-apexcharts";
import dayjs from "dayjs";

import { useDashboardQuery } from "../app/api";
import { PageHeader, money } from "./Common";

const mock = {
  kpis: {
    listings: 10482,
    listed: 7820,
    visits: 1264,
    closedValue: 183000000,
  },

  series: [
    120,
    180,
    160,
    240,
    220,
    310,
    280,
    340,
    390,
    410,
    460,
    520,
  ],

  funnel: [520, 430, 300, 210, 124],

  types: [42, 28, 18, 12],

  agents: [
    {
      name: "Riya Sharma",
      value: 62000000,
    },
    {
      name: "Kabir Singh",
      value: 51000000,
    },
    {
      name: "Arjun Nair",
      value: 39000000,
    },
    {
      name: "Sara Khan",
      value: 31000000,
    },
    {
      name: "Neha Kapoor",
      value: 28000000,
    },
  ],
};

export function DashboardPage() {
  const [from, setFrom] = useState(
    dayjs().subtract(30, "day").format("YYYY-MM-DD")
  );

  const [to, setTo] = useState(
    dayjs().format("YYYY-MM-DD")
  );

  const real = useDashboardQuery({
    from,
    to,
    tz: "Asia/Kolkata",
  });

  const d = real.data || mock;

  const cards = useMemo(
    () => [
      {
        label: "Total listings",
        value: d.kpis?.listings ?? 10482,
        change: "+12.4%",
      },
      {
        label: "Active listed",
        value: d.kpis?.listed ?? 7820,
        change: "+8.7%",
      },
      {
        label: "Site visits",
        value: d.kpis?.visits ?? 1264,
        change: "+16.2%",
      },
      {
        label: "Closed value",
        value: money(d.kpis?.closedValue ?? 183000000),
        change: "+11.8%",
      },
    ],
    [d]
  );

  const agentData = d.agents || mock.agents;

  const chartCategories = [
    "1",
    "4",
    "7",
    "10",
    "13",
    "16",
    "19",
    "22",
    "25",
    "28",
    "30",
  ];

  if (real.isLoading && !real.data) {
    return (
      <Box className="page">
        <PageHeader
          title="Dashboard"
          subtitle="Inventory and closing analytics"
        />

        <Grid container spacing={2}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Grid item xs={12} sm={6} md={3} key={index}>
              <Card>
                <CardContent>
                  <Skeleton width="55%" />
                  <Skeleton
                    width="70%"
                    height={45}
                  />
                  <Skeleton width="45%" />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Grid item xs={12} md={6} key={index}>
              <Card>
                <CardContent>
                  <Skeleton width="40%" height={35} />
                  <Skeleton
                    variant="rectangular"
                    height={280}
                    sx={{ mt: 1 }}
                  />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>
    );
  }

  return (
    <Box className="page">
      <PageHeader
        title="Dashboard"
        subtitle="Inventory and closing analytics"
        action={
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ width: { xs: "100%", sm: "auto" } }}
          >
            <TextField
              size="small"
              type="date"
              label="From"
              value={from}
              onChange={(event) =>
                setFrom(event.target.value)
              }
              InputLabelProps={{
                shrink: true,
              }}
            />

            <TextField
              size="small"
              type="date"
              label="To"
              value={to}
              onChange={(event) =>
                setTo(event.target.value)
              }
              InputLabelProps={{
                shrink: true,
              }}
            />
          </Stack>
        }
      />

      {/* KPI CARDS */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        {cards.map((card) => (
          <Grid
            item
            xs={12}
            sm={6}
            md={3}
            key={card.label}
          >
            <Card
              sx={{
                height: "100%",
              }}
            >
              <CardContent>
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  {card.label}
                </Typography>

                <Typography
                  variant="h5"
                  sx={{
                    mt: 1,
                    fontWeight: 800,
                  }}
                >
                  {typeof card.value === "number"
                    ? card.value.toLocaleString("en-IN")
                    : card.value}
                </Typography>

                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ mt: 1 }}
                >
                  <Chip
                    label={card.change}
                    size="small"
                    color="success"
                    variant="outlined"
                  />

                  <Typography
                    variant="caption"
                    color="text.secondary"
                  >
                    vs previous period
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* CHARTS */}
      <Grid container spacing={2}>
        <ChartCard
          title="Listings added over time"
          subtitle="New inventory during selected period"
          options={{
            chart: {
              id: "listings",
              toolbar: {
                show: false,
              },
            },
            stroke: {
              curve: "smooth",
              width: 3,
            },
            dataLabels: {
              enabled: false,
            },
            xaxis: {
              categories: chartCategories,
            },
            yaxis: {
              labels: {
                formatter: (value: number) =>
                  Math.round(value).toString(),
              },
            },
            tooltip: {
              y: {
                formatter: (value: number) =>
                  `${value} listings`,
              },
            },
          }}
          series={[
            {
              name: "Listings",
              data: d.series || mock.series,
            },
          ]}
          type="area"
        />

        <ChartCard
          title="Listing funnel"
          subtitle="Movement from listing to closure"
          options={{
            labels: [
              "Listed",
              "Site Visit",
              "Interested",
              "Negotiation",
              "Closed",
            ],
            legend: {
              position: "bottom",
            },
            dataLabels: {
              enabled: true,
            },
          }}
          series={d.funnel || mock.funnel}
          type="donut"
        />

        <ChartCard
          title="Property type split"
          subtitle="Current inventory distribution"
          options={{
            labels: [
              "Apartment",
              "Villa",
              "Plot",
              "Commercial",
            ],
            legend: {
              position: "bottom",
            },
            dataLabels: {
              enabled: true,
            },
          }}
          series={d.types || mock.types}
          type="donut"
        />

        <ChartCard
          title="Agent performance"
          subtitle="Closed value by agent"
          options={{
            chart: {
              type: "bar",
              toolbar: {
                show: false,
              },
            },
            plotOptions: {
              bar: {
                horizontal: true,
                borderRadius: 4,
              },
            },
            dataLabels: {
              enabled: false,
            },
            xaxis: {
              categories: agentData.map(
                (agent: any) => agent.name
              ),
              labels: {
                formatter: (value: string) =>
                  money(Number(value)),
              },
            },
            tooltip: {
              y: {
                formatter: (value: number) =>
                  money(value),
              },
            },
          }}
          series={[
            {
              name: "Closed value",
              data: agentData.map(
                (agent: any) => agent.value
              ),
            },
          ]}
          type="bar"
        />
      </Grid>
    </Box>
  );
}

function ChartCard({
  title,
  subtitle,
  options,
  series,
  type,
}: {
  title: string;
  subtitle: string;
  options: any;
  series: any;
  type: any;
}) {
  return (
    <Grid item xs={12} md={6}>
      <Card
        sx={{
          height: "100%",
        }}
      >
        <CardContent>
          <Typography
            variant="h6"
            sx={{ fontWeight: 700 }}
          >
            {title}
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 1 }}
          >
            {subtitle}
          </Typography>

          <Box
            sx={{
              width: "100%",
              overflow: "hidden",
            }}
          >
            <Chart
              options={options}
              series={series}
              type={type}
              height={280}
            />
          </Box>
        </CardContent>
      </Card>
    </Grid>
  );
}
