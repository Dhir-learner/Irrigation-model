"""Reproducible EDA profile and figures for the supplied dataset."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

from src.data_loader import DEFAULT_DATA_PATH, PROJECT_ROOT, load_data, save_dataset_profile


def run_eda(data_path: str | Path = DEFAULT_DATA_PATH, output_dir: str | Path = PROJECT_ROOT / "reports") -> None:
    output = Path(output_dir)
    figures = output / "figures"
    figures.mkdir(parents=True, exist_ok=True)
    df = load_data(data_path)
    save_dataset_profile(df, output / "dataset_profile.json")
    sns.set_theme(style="whitegrid", palette="deep")

    distributions = [
        ("Soil_Moisture", "Soil moisture distribution", "soil_moisture_distribution.png"),
        ("Temperature_C", "Temperature distribution", "temperature_distribution.png"),
        ("Rainfall_mm", "Rainfall distribution", "rainfall_distribution.png"),
    ]
    for column, title, filename in distributions:
        fig, axis = plt.subplots(figsize=(7, 4.5))
        sns.histplot(data=df, x=column, bins=25, kde=True, ax=axis, color="#1f77b4")
        axis.set_title(title)
        fig.tight_layout()
        fig.savefig(figures / filename, dpi=150)
        plt.close(fig)

    for x_column, title, filename in [
        ("NDVI", "NDVI vs soil moisture", "ndvi_vs_soil_moisture.png"),
        ("LAI", "LAI vs soil moisture", "lai_vs_soil_moisture.png"),
        ("Rainfall_mm", "Rainfall vs soil moisture", "rainfall_vs_soil_moisture.png"),
        ("Temperature_C", "Temperature vs soil moisture", "temperature_vs_soil_moisture.png"),
    ]:
        fig, axis = plt.subplots(figsize=(7, 4.5))
        sns.regplot(data=df, x=x_column, y="Soil_Moisture", scatter_kws={"alpha": 0.55, "s": 20}, ax=axis)
        axis.set_title(title)
        fig.tight_layout()
        fig.savefig(figures / filename, dpi=150)
        plt.close(fig)

    numeric = df.select_dtypes(include="number")
    # A field with effectively zero variation cannot have an interpretable correlation.
    numeric = numeric.loc[:, numeric.std(numeric_only=True) > 1e-10]
    fig, axis = plt.subplots(figsize=(11, 8))
    sns.heatmap(numeric.corr(), cmap="vlag", center=0, annot=False, square=False, ax=axis)
    axis.set_title("Numeric feature correlation heatmap")
    fig.tight_layout()
    fig.savefig(figures / "correlation_heatmap.png", dpi=150)
    plt.close(fig)

    fig, axis = plt.subplots(figsize=(7, 4.5))
    sns.boxplot(data=df, x="District", y="Soil_Moisture", color="#8fbcd4", ax=axis)
    axis.set_title("District-wise soil moisture")
    fig.tight_layout()
    fig.savefig(figures / "district_soil_moisture.png", dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    run_eda()
    print("EDA profile and figures written to reports/.")
