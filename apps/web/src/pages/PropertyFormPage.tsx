import { useEffect, useMemo, useState } from "react";
import {
  Controller,
  useForm,
  type UseFormRegister,
} from "react-hook-form";

import { propertyCreateSchema } from "../../../../packages/shared/src/property";
import { z } from "zod";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";

import {
  ContentCopy,
  WarningAmber,
} from "@mui/icons-material";

import { useNavigate } from "react-router-dom";

import {
  useCreatePropertyMutation,
  useMasterDataQuery,
} from "../app/api";

import { PageHeader } from "./Common";

/* =========================================================
   TYPES
========================================================= */

type FormValues = z.infer<
  typeof propertyCreateSchema
>;

const steps = [
  "Basics",
  "Location",
  "Pricing & size",
  "Owner",
  "Amenities",
];

/* =========================================================
   DEFAULT VALUES
========================================================= */

const defaults: FormValues = {
  title: "",
  typeId: 1,
  listingType: "SALE",
  bhk: 2,
  furnishing: "UNFURNISHED",
  statusId: 2,

  buildingName: "",
  unitNo: "",

  floor: null,
  totalFloors: null,

  localityId: 1,
  city: "Patna",
  address: "",

  priceInr: 5000000,
  carpetAreaSqft: 1000,

  ownerName: "",
  ownerPhone: "",

  amenityIds: [],
};

/* =========================================================
   OPTIONS
========================================================= */

const propertyTypes = [
  { value: 1, label: "Apartment" },
  { value: 2, label: "Villa" },
  { value: 3, label: "Plot" },
  { value: 4, label: "Commercial" },
];

const furnishingOptions = [
  {
    value: "UNFURNISHED",
    label: "Unfurnished",
  },
  {
    value: "SEMI_FURNISHED",
    label: "Semi furnished",
  },
  {
    value: "FULLY_FURNISHED",
    label: "Fully furnished",
  },
];

const localityOptions = [
  {
    value: 1,
    label: "Bandra West",
  },
  {
    value: 2,
    label: "Andheri East",
  },
  {
    value: 3,
    label: "Gurugram",
  },
  {
    value: 4,
    label: "Kankarbagh",
  },
];

const amenities = [
  "Lift",
  "Parking",
  "Power Backup",
  "Gym",
  "Swimming Pool",
  "Clubhouse",
  "Security",
  "Garden",
  "Children Play Area",
  "Gated Community",
];

/* =========================================================
   PAGE
========================================================= */

export function PropertyFormPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState(0);

  const [showUnsavedDialog, setShowUnsavedDialog] =
    useState(false);

  const [pendingNavigation, setPendingNavigation] =
    useState<string | null>(null);

  const [showConflictDialog, setShowConflictDialog] =
    useState(false);

  const [conflictMessage, setConflictMessage] =
    useState("");

  const [duplicateMessage, setDuplicateMessage] =
    useState("");

  const [validationMessage, setValidationMessage] =
    useState("");

  /* =======================================================
     API
  ======================================================= */

  const [createProperty, createState] =
    useCreatePropertyMutation();

  useMasterDataQuery();

  /* =======================================================
     FORM
  ======================================================= */

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: {
      errors,
      isDirty,
      isSubmitting,
    },
  } = useForm<FormValues>({
    defaultValues: defaults,
    mode: "onBlur",
  });

  /* =======================================================
     WATCH VALUES
  ======================================================= */

  const price = watch("priceInr");
  const area = watch("carpetAreaSqft");

  const buildingName = watch("buildingName");
  const unitNo = watch("unitNo");

  /* =======================================================
     PRICE / SQFT
  ======================================================= */

  const pricePerSqft = useMemo(() => {
    if (
      !price ||
      !area ||
      Number(area) <= 0
    ) {
      return 0;
    }

    return Math.round(
      Number(price) / Number(area)
    );
  }, [price, area]);

  /* =======================================================
     BROWSER UNSAVED CHANGES
  ======================================================= */

  useEffect(() => {
    const handleBeforeUnload = (
      event: BeforeUnloadEvent
    ) => {
      if (
        !isDirty ||
        createState.isSuccess
      ) {
        return;
      }

      event.preventDefault();

      event.returnValue = "";
    };

    window.addEventListener(
      "beforeunload",
      handleBeforeUnload
    );

    return () => {
      window.removeEventListener(
        "beforeunload",
        handleBeforeUnload
      );
    };
  }, [
    isDirty,
    createState.isSuccess,
  ]);

  /* =======================================================
     SAFE NAVIGATION
  ======================================================= */

  const safeNavigate = (
    destination: string
  ) => {
    if (
      isDirty &&
      !createState.isSuccess
    ) {
      setPendingNavigation(destination);
      setShowUnsavedDialog(true);
      return;
    }

    navigate(destination);
  };

  const confirmNavigation = () => {
    setShowUnsavedDialog(false);

    if (pendingNavigation) {
      navigate(pendingNavigation);
    }

    setPendingNavigation(null);
  };

  const cancelNavigation = () => {
    setShowUnsavedDialog(false);
    setPendingNavigation(null);
  };

  /* =======================================================
     DUPLICATE BUILDING + UNIT
  ======================================================= */

  const duplicateBuildingUnit = () => {
    if (!buildingName && !unitNo) {
      setDuplicateMessage(
        "Enter a building name and unit number first."
      );

      return;
    }

    const duplicateUnit = unitNo
      ? `${unitNo}-COPY`
      : "";

    setValue(
      "buildingName",
      buildingName ?? "",
      {
        shouldDirty: true,
        shouldValidate: true,
      }
    );

    setValue(
      "unitNo",
      duplicateUnit,
      {
        shouldDirty: true,
        shouldValidate: true,
      }
    );

    setDuplicateMessage(
      "Building copied. A duplicate unit number has been prepared. Change it before saving."
    );
  };

  /* =======================================================
     STEP VALIDATION
  ======================================================= */

  const validateCurrentStep = async () => {
    setValidationMessage("");

    let fields: Array<keyof FormValues> = [];

    if (step === 0) {
      fields = [
        "title",
        "typeId",
        "listingType",
        "bhk",
        "furnishing",
      ];
    }

    if (step === 1) {
      fields = [
        "buildingName",
        "unitNo",
        "floor",
        "totalFloors",
        "localityId",
        "city",
        "address",
      ];
    }

    if (step === 2) {
      fields = [
        "priceInr",
        "carpetAreaSqft",
      ];
    }

    if (step === 3) {
      fields = [
        "ownerName",
        "ownerPhone",
      ];
    }

    const valid = await trigger(fields);

    if (!valid) {
      setValidationMessage(
        "Please fix the highlighted fields before continuing."
      );

      return;
    }

    setStep((current) =>
      Math.min(
        current + 1,
        steps.length - 1
      )
    );
  };

  /* =======================================================
     SUBMIT
  ======================================================= */

  const submit = async (
    values: FormValues
  ) => {
    setValidationMessage("");

    /*
     * Manual Zod validation.
     *
     * We intentionally do not use zodResolver
     * because the shared schema's inferred
     * input/output type can differ from RHF's
     * form type due to coercion/transforms.
     */
    const parsed =
      propertyCreateSchema.safeParse(
        values
      );

    if (!parsed.success) {
      setValidationMessage(
        "Please check the form fields. Some values are invalid."
      );

      return;
    }

    try {
      await createProperty(
        parsed.data
      ).unwrap();

      navigate("/properties");
    } catch (error: any) {
      const status =
        error?.status ??
        error?.originalStatus;

      /* ===============================================
         409 CONFLICT
      =============================================== */

      if (status === 409) {
        setConflictMessage(
          error?.data?.message ??
            "This property already exists or another user created a conflicting listing."
        );

        setShowConflictDialog(true);

        return;
      }

      setValidationMessage(
        "Unable to save the property. Please try again."
      );
    }
  };

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <Box className="page">

      {/* ===================================================
          HEADER
      =================================================== */}

      <PageHeader
        title="Add property"
        subtitle="Create a property using the five-section listing workflow"
      />

      {/* ===================================================
          VALIDATION / API ERROR
      =================================================== */}

      {validationMessage && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
        >
          {validationMessage}
        </Alert>
      )}

      {createState.isError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
        >
          Unable to save property.
          Please check your information
          and try again.
        </Alert>
      )}

      {/* ===================================================
          FORM CARD
      =================================================== */}

      <Card>
        <CardContent>

          {/* =================================================
              STEPPER
          ================================================= */}

          <Stepper
            activeStep={step}
            alternativeLabel
            sx={{ mb: 4 }}
          >
            {steps.map(
              (stepName) => (
                <Step
                  key={stepName}
                >
                  <StepLabel>
                    {stepName}
                  </StepLabel>
                </Step>
              )
            )}
          </Stepper>

          <form
            onSubmit={handleSubmit(
              submit
            )}
          >

            {/* ===============================================
                BASICS
            =============================================== */}

            {step === 0 && (
              <Grid
                container
                spacing={2}
              >

                <Field
                  name="title"
                  label="Property title"
                  register={register}
                  error={
                    errors.title?.message
                  }
                  full
                />

                <Field
                  name="typeId"
                  label="Property type"
                  register={register}
                  select
                  options={
                    propertyTypes
                  }
                  error={
                    errors.typeId?.message
                  }
                />

                <Field
                  name="listingType"
                  label="Sale / Rent"
                  register={register}
                  select
                  options={[
                    {
                      value: "SALE",
                      label: "Sale",
                    },
                    {
                      value: "RENT",
                      label: "Rent",
                    },
                  ]}
                  error={
                    errors.listingType
                      ?.message
                  }
                />

                <Field
                  name="bhk"
                  label="BHK"
                  type="number"
                  register={register}
                  error={
                    errors.bhk?.message
                  }
                />

                <Field
                  name="furnishing"
                  label="Furnishing"
                  register={register}
                  select
                  options={
                    furnishingOptions
                  }
                  error={
                    errors.furnishing
                      ?.message
                  }
                />

              </Grid>
            )}

            {/* ===============================================
                LOCATION
            =============================================== */}

            {step === 1 && (
              <Grid
                container
                spacing={2}
              >

                <Field
                  name="buildingName"
                  label="Building name"
                  register={register}
                  error={
                    errors.buildingName
                      ?.message
                  }
                />

                <Field
                  name="unitNo"
                  label="Unit number"
                  register={register}
                  error={
                    errors.unitNo?.message
                  }
                />

                {/* ===========================================
                    DUPLICATE
                =========================================== */}

                <Grid
                  item
                  xs={12}
                >
                  <Paper
                    variant="outlined"
                    sx={{ p: 2 }}
                  >

                    <Stack
                      direction={{
                        xs: "column",
                        sm: "row",
                      }}
                      spacing={2}
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
                          Duplicate building & unit
                        </Typography>

                        <Typography
                          variant="body2"
                          color="text.secondary"
                        >
                          Prepare another listing
                          in the same building.
                        </Typography>
                      </Box>

                      <Button
                        variant="outlined"
                        startIcon={
                          <ContentCopy />
                        }
                        onClick={
                          duplicateBuildingUnit
                        }
                      >
                        Duplicate
                      </Button>

                    </Stack>

                    {duplicateMessage && (
                      <Alert
                        severity="info"
                        sx={{ mt: 2 }}
                      >
                        {duplicateMessage}
                      </Alert>
                    )}

                  </Paper>
                </Grid>

                <Field
                  name="floor"
                  label="Floor"
                  type="number"
                  register={register}
                  error={
                    errors.floor?.message
                  }
                />

                <Field
                  name="totalFloors"
                  label="Total floors"
                  type="number"
                  register={register}
                  error={
                    errors.totalFloors
                      ?.message
                  }
                />

                <Field
                  name="localityId"
                  label="Locality"
                  register={register}
                  select
                  options={
                    localityOptions
                  }
                  error={
                    errors.localityId
                      ?.message
                  }
                />

                <Field
                  name="city"
                  label="City"
                  register={register}
                  error={
                    errors.city?.message
                  }
                />

                <Field
                  name="address"
                  label="Address"
                  register={register}
                  error={
                    errors.address
                      ?.message
                  }
                  full
                />

              </Grid>
            )}

            {/* ===============================================
                PRICING & SIZE
            =============================================== */}

            {step === 2 && (
              <Grid
                container
                spacing={2}
              >

                <Field
                  name="priceInr"
                  label="Price (₹)"
                  type="number"
                  register={register}
                  error={
                    errors.priceInr
                      ?.message
                  }
                />

                <Field
                  name="carpetAreaSqft"
                  label="Carpet area (sq ft)"
                  type="number"
                  register={register}
                  error={
                    errors.carpetAreaSqft
                      ?.message
                  }
                />

                <Grid
                  item
                  xs={12}
                  md={6}
                >
                  <Alert severity="info">
                    <Typography
                      fontWeight={700}
                    >
                      Live price / sq ft
                    </Typography>

                    <Typography>
                      ₹
                      {pricePerSqft.toLocaleString(
                        "en-IN"
                      )}
                    </Typography>
                  </Alert>
                </Grid>

              </Grid>
            )}

            {/* ===============================================
                OWNER
            =============================================== */}

            {step === 3 && (
              <Grid
                container
                spacing={2}
              >

                <Field
                  name="ownerName"
                  label="Owner name"
                  register={register}
                  error={
                    errors.ownerName
                      ?.message
                  }
                />

                <Field
                  name="ownerPhone"
                  label="Owner phone"
                  register={register}
                  error={
                    errors.ownerPhone
                      ?.message
                  }
                />

              </Grid>
            )}

            {/* ===============================================
                AMENITIES
            =============================================== */}

            {step === 4 && (
              <Grid
                container
                spacing={2}
              >

                <Grid
                  item
                  xs={12}
                >

                  <Typography
                    variant="h6"
                    sx={{ mb: 1 }}
                  >
                    Amenities
                  </Typography>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    Select all amenities
                    available at this property.
                  </Typography>

                  <Controller
                    name="amenityIds"
                    control={control}
                    render={({
                      field,
                    }) => (
                      <Stack
                        direction="row"
                        spacing={1}
                        flexWrap="wrap"
                        useFlexGap
                      >

                        {amenities.map(
                          (
                            amenity,
                            index
                          ) => {
                            const id =
                              index + 1;

                            const selected =
                              (
                                field.value ??
                                []
                              ).includes(
                                id
                              );

                            return (
                              <Chip
                                key={
                                  amenity
                                }
                                label={
                                  amenity
                                }
                                color={
                                  selected
                                    ? "primary"
                                    : "default"
                                }
                                variant={
                                  selected
                                    ? "filled"
                                    : "outlined"
                                }
                                onClick={() => {
                                  const current =
                                    field.value ??
                                    [];

                                  const next =
                                    current.includes(
                                      id
                                    )
                                      ? current.filter(
                                          (
                                            value
                                          ) =>
                                            value !==
                                            id
                                        )
                                      : [
                                          ...current,
                                          id,
                                        ];

                                  field.onChange(
                                    next
                                  );
                                }}
                              />
                            );
                          }
                        )}

                      </Stack>
                    )}
                  />

                </Grid>

              </Grid>
            )}

            {/* =================================================
                BUTTONS
            ================================================= */}

            <Divider
              sx={{
                mt: 4,
                mb: 3,
              }}
            />

            <Stack
              direction={{
                xs: "column-reverse",
                sm: "row",
              }}
              spacing={1.5}
              justifyContent="space-between"
            >

              <Button
                onClick={() => {
                  if (step === 0) {
                    safeNavigate(
                      "/properties"
                    );
                  } else {
                    setStep(
                      (current) =>
                        current - 1
                    );
                  }
                }}
              >
                {step === 0
                  ? "Cancel"
                  : "Back"}
              </Button>

              {step <
              steps.length - 1 ? (
                <Button
                  variant="contained"
                  onClick={
                    validateCurrentStep
                  }
                >
                  Continue
                </Button>
              ) : (
                <Button
                  variant="contained"
                  type="submit"
                  disabled={
                    isSubmitting ||
                    createState.isLoading
                  }
                >
                  {createState.isLoading
                    ? "Saving..."
                    : "Save property"}
                </Button>
              )}

            </Stack>

          </form>

        </CardContent>
      </Card>

      {/* =====================================================
          UNSAVED CHANGES
      ===================================================== */}

      <Dialog
        open={showUnsavedDialog}
        onClose={cancelNavigation}
        maxWidth="xs"
        fullWidth
      >

        <DialogTitle>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
          >
            <WarningAmber color="warning" />

            <Typography
              component="span"
              fontWeight={700}
            >
              Unsaved changes
            </Typography>
          </Stack>
        </DialogTitle>

        <DialogContent>
          <Typography>
            You have unsaved changes on this
            property form. If you leave now,
            your changes will be lost.
          </Typography>
        </DialogContent>

        <DialogActions>

          <Button
            onClick={
              cancelNavigation
            }
          >
            Stay
          </Button>

          <Button
            color="error"
            variant="contained"
            onClick={
              confirmNavigation
            }
          >
            Leave page
          </Button>

        </DialogActions>

      </Dialog>

      {/* =====================================================
          409 CONFLICT
      ===================================================== */}

      <Dialog
        open={showConflictDialog}
        onClose={() =>
          setShowConflictDialog(
            false
          )
        }
        maxWidth="sm"
        fullWidth
      >

        <DialogTitle>
          Property conflict
        </DialogTitle>

        <DialogContent>

          <Alert
            severity="warning"
            sx={{ mb: 2 }}
          >
            Another listing may already
            exist for this building and
            unit.
          </Alert>

          <Typography>
            {conflictMessage}
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 2 }}
          >
            Review the building and unit
            information before trying again.
          </Typography>

        </DialogContent>

        <DialogActions>

          <Button
            onClick={() =>
              setShowConflictDialog(
                false
              )
            }
          >
            Close
          </Button>

          <Button
            variant="contained"
            onClick={() => {
              setShowConflictDialog(
                false
              );
              setStep(1);
            }}
          >
            Review location
          </Button>

        </DialogActions>

      </Dialog>

    </Box>
  );
}

/* =========================================================
   FIELD COMPONENT
========================================================= */

type FieldProps = {
  name: keyof FormValues;
  label: string;

  register: UseFormRegister<FormValues>;

  error?: string;

  type?: string;

  select?: boolean;

  options?: Array<{
    value: string | number;
    label: string;
  }>;

  full?: boolean;
};

function Field({
  name,
  label,
  register,
  error,
  type,
  select,
  options,
  full,
}: FieldProps) {
  return (
    <Grid
      item
      xs={12}
      md={full ? 12 : 6}
    >
      <TextField
        fullWidth
        label={label}
        type={type}
        select={select}
        error={Boolean(error)}
        helperText={error}
        {...register(name)}
      >
        {options?.map(
          (option) => (
            <MenuItem
              key={option.value}
              value={option.value}
            >
              {option.label}
            </MenuItem>
          )
        )}
      </TextField>
    </Grid>
  );
}