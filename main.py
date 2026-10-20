
"""Forma Credit Risk Studio — FastAPI dashboard and prediction API."""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


# --------------------------------------
# PROJECT PATHS
# --------------------------------------

BASE_DIR = Path(__file__).resolve().parent

PUBLIC_DIR = BASE_DIR / "public"

MODEL_DIR = Path(
    os.environ.get(
        "MODEL_DIR",
        str(BASE_DIR / "Major project")
    )
).resolve()


logger = logging.getLogger("uvicorn.error")

ml_model = {}


# --------------------------------------
# LOAD MACHINE LEARNING MODEL
# --------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):

    try:
        model_path = MODEL_DIR / "credit_risk_model.pkl"
        threshold_path = MODEL_DIR / "best_threshold.pkl"

        ml_model["model"] = joblib.load(model_path)

        ml_model["threshold"] = float(
            joblib.load(threshold_path)
        )

        if not (0 <= ml_model["threshold"] <= 1):
            raise ValueError(
                "Saved threshold must be between 0 and 1"
            )

        logger.info(
            "Credit risk model and threshold loaded successfully."
        )

    except Exception as exc:

        ml_model.clear()

        logger.error(
            "Could not load model artifacts from %s: %s",
            MODEL_DIR,
            exc
        )

    yield

    ml_model.clear()


# --------------------------------------
# FASTAPI APPLICATION
# --------------------------------------

app = FastAPI(
    title="Forma Credit Risk API",
    version="1.0.0",
    description="Estimate credit default probability using a trained ML model.",
    lifespan=lifespan
)


# --------------------------------------
# STATIC FRONTEND FILES
# --------------------------------------

if PUBLIC_DIR.is_dir():

    app.mount(
        "/static",
        StaticFiles(directory=str(PUBLIC_DIR)),
        name="static"
    )

else:
    logger.warning(
        "Public folder not found: %s",
        PUBLIC_DIR
    )


# --------------------------------------
# LOAN APPLICATION INPUT
# --------------------------------------

class LoanApplication(BaseModel):

    person_age: int = Field(gt=0)

    person_income: float = Field(gt=0)

    person_home_ownership: str

    person_emp_length: float = Field(ge=0)

    loan_intent: str

    loan_grade: str

    loan_amnt: float = Field(gt=0)

    loan_int_rate: float = Field(ge=0)

    loan_percent_income: float = Field(ge=0)

    cb_person_default_on_file: str

    cb_person_cred_hist_length: int = Field(ge=0)


# --------------------------------------
# FRONTEND HOMEPAGE
# --------------------------------------

@app.get("/", include_in_schema=False)
def index():

    index_path = PUBLIC_DIR / "index.html"

    if not index_path.is_file():
        raise HTTPException(
            status_code=503,
            detail="Frontend index.html is missing."
        )

    return FileResponse(
        index_path,
        media_type="text/html"
    )


# --------------------------------------
# SERVER HEALTH CHECK
# --------------------------------------

@app.get("/health")
def health():

    model_loaded = (
        "model" in ml_model
        and "threshold" in ml_model
    )

    return {
        "status": (
            "ready"
            if model_loaded
            else "model_unavailable"
        ),
        "model_loaded": model_loaded
    }


# --------------------------------------
# CREDIT RISK PREDICTION
# --------------------------------------

@app.post("/predict")
def predict(data: LoanApplication):

    if (
        "model" not in ml_model
        or "threshold" not in ml_model
    ):
        raise HTTPException(
            status_code=503,
            detail="Prediction model is unavailable. Check model files."
        )

    model = ml_model["model"]

    input_df = pd.DataFrame(
        [data.model_dump()],
        columns=list(LoanApplication.model_fields)
    )

    try:

        probabilities = model.predict_proba(input_df)[0]

        classes = list(model.classes_)

        if 1 not in classes:
            raise ValueError(
                "Model does not contain default class 1"
            )

        probability = float(
            probabilities[classes.index(1)]
        )

        threshold = float(ml_model["threshold"])

        prediction = int(
            probability >= threshold
        )

    except Exception as exc:

        logger.exception(
            "Model inference failed: %s",
            exc
        )

        raise HTTPException(
            status_code=500,
            detail="Model prediction failed. Check server logs."
        ) from exc

    return {
        "default_probability": probability,
        "default_prediction": prediction,
        "threshold": threshold,
        "result": (
            "High risk"
            if prediction == 1
            else "Low risk"
        )
    }
