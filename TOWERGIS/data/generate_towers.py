import json
import random
import math
from pathlib import Path

# ============================================================
# TOWERGIS - TELECOM TOWER DUMMY DATA GENERATOR
# ============================================================
#
# Generates 10,000 telecom tower locations across India.
#
# Distribution:
#   - Pune
#   - Mumbai
#   - Maharashtra
#   - Rest of India
#
# Output:
#   data/towers.geojson
#   data/towers.json
#
# ============================================================


TOTAL_TOWERS = 10000

random.seed(42)


# ============================================================
# OUTPUT DIRECTORY
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

GEOJSON_FILE = BASE_DIR / "towers.geojson"
JSON_FILE = BASE_DIR / "towers.json"


# ============================================================
# OPERATORS
# ============================================================

OPERATORS = [
    "Jio",
    "Airtel",
    "Vi",
    "BSNL"
]


# ============================================================
# TECHNOLOGIES
# ============================================================

TECHNOLOGIES = [
    "3G",
    "4G",
    "5G"
]


# ============================================================
# NETWORK BANDS
# ============================================================

BANDS = {
    "3G": [
        "900 MHz",
        "2100 MHz"
    ],

    "4G": [
        "700 MHz",
        "800 MHz",
        "1800 MHz",
        "2100 MHz",
        "2300 MHz"
    ],

    "5G": [
        "700 MHz",
        "3300 MHz",
        "3500 MHz"
    ]
}


# ============================================================
# MAJOR INDIAN LOCATIONS
# ============================================================

LOCATIONS = [

    # --------------------------------------------------------
    # PUNE
    # --------------------------------------------------------

    {
        "name": "Pune",
        "state": "Maharashtra",
        "lat": 18.5204,
        "lon": 73.8567,
        "radius": 0.30,
        "weight": 2200
    },

    # --------------------------------------------------------
    # MUMBAI
    # --------------------------------------------------------

    {
        "name": "Mumbai",
        "state": "Maharashtra",
        "lat": 19.0760,
        "lon": 72.8777,
        "radius": 0.35,
        "weight": 1800
    },

    # --------------------------------------------------------
    # MAHARASHTRA
    # --------------------------------------------------------

    {
        "name": "Nashik",
        "state": "Maharashtra",
        "lat": 20.0110,
        "lon": 73.7903,
        "radius": 0.30,
        "weight": 500
    },

    {
        "name": "Nagpur",
        "state": "Maharashtra",
        "lat": 21.1458,
        "lon": 79.0882,
        "radius": 0.40,
        "weight": 500
    },

    {
        "name": "Aurangabad",
        "state": "Maharashtra",
        "lat": 19.8762,
        "lon": 75.3433,
        "radius": 0.30,
        "weight": 350
    },

    {
        "name": "Kolhapur",
        "state": "Maharashtra",
        "lat": 16.7050,
        "lon": 74.2433,
        "radius": 0.25,
        "weight": 250
    },

    {
        "name": "Navi Mumbai",
        "state": "Maharashtra",
        "lat": 19.0330,
        "lon": 73.0297,
        "radius": 0.25,
        "weight": 300
    },

    {
        "name": "Thane",
        "state": "Maharashtra",
        "lat": 19.2183,
        "lon": 72.9781,
        "radius": 0.25,
        "weight": 300
    },

    # --------------------------------------------------------
    # OTHER MAJOR INDIAN CITIES
    # --------------------------------------------------------

    {
        "name": "Delhi",
        "state": "Delhi",
        "lat": 28.6139,
        "lon": 77.2090,
        "radius": 0.60,
        "weight": 350
    },

    {
        "name": "Bengaluru",
        "state": "Karnataka",
        "lat": 12.9716,
        "lon": 77.5946,
        "radius": 0.50,
        "weight": 350
    },

    {
        "name": "Hyderabad",
        "state": "Telangana",
        "lat": 17.3850,
        "lon": 78.4867,
        "radius": 0.50,
        "weight": 300
    },

    {
        "name": "Chennai",
        "state": "Tamil Nadu",
        "lat": 13.0827,
        "lon": 80.2707,
        "radius": 0.50,
        "weight": 300
    },

    {
        "name": "Kolkata",
        "state": "West Bengal",
        "lat": 22.5726,
        "lon": 88.3639,
        "radius": 0.50,
        "weight": 300
    },

    {
        "name": "Ahmedabad",
        "state": "Gujarat",
        "lat": 23.0225,
        "lon": 72.5714,
        "radius": 0.50,
        "weight": 250
    },

    {
        "name": "Jaipur",
        "state": "Rajasthan",
        "lat": 26.9124,
        "lon": 75.7873,
        "radius": 0.50,
        "weight": 200
    },

    {
        "name": "Lucknow",
        "state": "Uttar Pradesh",
        "lat": 26.8467,
        "lon": 80.9462,
        "radius": 0.50,
        "weight": 200
    },

    {
        "name": "Surat",
        "state": "Gujarat",
        "lat": 21.1702,
        "lon": 72.8311,
        "radius": 0.40,
        "weight": 200
    },

    {
        "name": "Patna",
        "state": "Bihar",
        "lat": 25.5941,
        "lon": 85.1376,
        "radius": 0.40,
        "weight": 150
    },

    {
        "name": "Bhopal",
        "state": "Madhya Pradesh",
        "lat": 23.2599,
        "lon": 77.4126,
        "radius": 0.40,
        "weight": 150
    },

    {
        "name": "Bhubaneswar",
        "state": "Odisha",
        "lat": 20.2961,
        "lon": 85.8245,
        "radius": 0.40,
        "weight": 150
    },

    {
        "name": "Guwahati",
        "state": "Assam",
        "lat": 26.1445,
        "lon": 91.7362,
        "radius": 0.40,
        "weight": 150
    },

    {
        "name": "Chandigarh",
        "state": "Chandigarh",
        "lat": 30.7333,
        "lon": 76.7794,
        "radius": 0.30,
        "weight": 120
    }
]


# ============================================================
# WEIGHTED LOCATION SELECTION
# ============================================================

LOCATION_POOL = []

for location in LOCATIONS:

    for _ in range(location["weight"]):

        LOCATION_POOL.append(location)


# ============================================================
# RANDOM NUMBER HELPERS
# ============================================================

def random_float(min_value, max_value):

    return random.uniform(
        min_value,
        max_value
    )


def random_choice(items):

    return random.choice(items)


# ============================================================
# GENERATE TOWER
# ============================================================

def generate_tower(index):

    location = random_choice(LOCATION_POOL)

    center_lat = location["lat"]
    center_lon = location["lon"]

    # Random distance around city centre
    lat_offset = random.uniform(
        -location["radius"],
        location["radius"]
    )

    lon_offset = random.uniform(
        -location["radius"],
        location["radius"]
    )

    latitude = center_lat + lat_offset
    longitude = center_lon + lon_offset

    # --------------------------------------------------------
    # OPERATOR
    # --------------------------------------------------------

    operator = random_choice(
        OPERATORS
    )

    # --------------------------------------------------------
    # TECHNOLOGY
    # --------------------------------------------------------

    technology_probability = random.random()

    if technology_probability < 0.45:

        technology = "4G"

    elif technology_probability < 0.75:

        technology = "5G"

    else:

        technology = "3G"

    # --------------------------------------------------------
    # BAND
    # --------------------------------------------------------

    band = random_choice(
        BANDS[technology]
    )

    # --------------------------------------------------------
    # SIGNAL STRENGTH
    # --------------------------------------------------------

    if technology == "5G":

        signal_strength = random.randint(
            -85,
            -45
        )

    elif technology == "4G":

        signal_strength = random.randint(
            -100,
            -55
        )

    else:

        signal_strength = random.randint(
            -110,
            -70
        )

    # --------------------------------------------------------
    # COVERAGE RADIUS
    # --------------------------------------------------------

    if technology == "5G":

        coverage_radius = random.randint(
            200,
            800
        )

    elif technology == "4G":

        coverage_radius = random.randint(
            500,
            1800
        )

    else:

        coverage_radius = random.randint(
            800,
            2500
        )

    # --------------------------------------------------------
    # TOWER HEIGHT
    # --------------------------------------------------------

    tower_height = random.randint(
        20,
        80
    )

    # --------------------------------------------------------
    # AZIMUTH
    # --------------------------------------------------------

    azimuth = random.randint(
        0,
        359
    )

    # --------------------------------------------------------
    # STATUS
    # --------------------------------------------------------

    status_probability = random.random()

    if status_probability < 0.90:

        status = "Active"

    elif status_probability < 0.97:

        status = "Maintenance"

    else:

        status = "Inactive"

    # --------------------------------------------------------
    # 5G CAPABLE
    # --------------------------------------------------------

    five_g = technology == "5G"

    # --------------------------------------------------------
    # DOWNLOAD SPEED
    # --------------------------------------------------------

    if technology == "5G":

        download_speed = random.randint(
            100,
            1000
        )

    elif technology == "4G":

        download_speed = random.randint(
            20,
            150
        )

    else:

        download_speed = random.randint(
            1,
            15
        )

    # --------------------------------------------------------
    # UPLOAD SPEED
    # --------------------------------------------------------

    if technology == "5G":

        upload_speed = random.randint(
            20,
            200
        )

    elif technology == "4G":

        upload_speed = random.randint(
            5,
            50
        )

    else:

        upload_speed = random.randint(
            1,
            8
        )

    # --------------------------------------------------------
    # TOWER TYPE
    # --------------------------------------------------------

    tower_types = [
        "Macro",
        "Micro",
        "Small Cell",
        "Rooftop"
    ]

    tower_type = random_choice(
        tower_types
    )

    # --------------------------------------------------------
    # RETURN TOWER
    # --------------------------------------------------------

    return {

        "tower_id":
            f"TWR-{index:05d}",

        "operator":
            operator,

        "tower_type":
            tower_type,

        "technology":
            technology,

        "3g":
            technology == "3G",

        "4g":
            technology == "4G",

        "5g":
            five_g,

        "band":
            band,

        "frequency":
            band,

        "latitude":
            round(latitude, 6),

        "longitude":
            round(longitude, 6),

        "coverage_radius_m":
            coverage_radius,

        "signal_strength_dbm":
            signal_strength,

        "tower_height_m":
            tower_height,

        "azimuth":
            azimuth,

        "status":
            status,

        "download_speed_mbps":
            download_speed,

        "upload_speed_mbps":
            upload_speed,

        "city":
            location["name"],

        "state":
            location["state"],

        "country":
            "India"

    }


# ============================================================
# GENERATE DATA
# ============================================================

print()
print("=" * 60)
print("TOWERGIS TELECOM TOWER DATA GENERATOR")
print("=" * 60)
print()

towers = []

for i in range(
    1,
    TOTAL_TOWERS + 1
):

    tower = generate_tower(i)

    towers.append(
        tower
    )

    if i % 1000 == 0:

        print(
            f"Generated {i:,} towers..."
        )


# ============================================================
# CREATE GEOJSON
# ============================================================

features = []

for tower in towers:

    feature = {

        "type": "Feature",

        "geometry": {

            "type": "Point",

            "coordinates": [

                tower["longitude"],
                tower["latitude"]

            ]

        },

        "properties": tower

    }

    features.append(
        feature
    )


geojson = {

    "type": "FeatureCollection",

    "name": "TOWERGIS_Telecom_Towers",

    "features": features

}


# ============================================================
# SAVE GEOJSON
# ============================================================

with open(
    GEOJSON_FILE,
    "w",
    encoding="utf-8"
) as file:

    json.dump(
        geojson,
        file,
        indent=2
    )


# ============================================================
# SAVE NORMAL JSON
# ============================================================

with open(
    JSON_FILE,
    "w",
    encoding="utf-8"
) as file:

    json.dump(
        towers,
        file,
        indent=2
    )


# ============================================================
# STATISTICS
# ============================================================

print()
print("=" * 60)
print("DATA GENERATION COMPLETE")
print("=" * 60)

print()

print(
    f"Total towers : {len(towers):,}"
)

print()

# Operator statistics

operator_counts = {}

for tower in towers:

    operator = tower["operator"]

    operator_counts[operator] = (
        operator_counts.get(
            operator,
            0
        ) + 1
    )


print("OPERATORS")
print("-" * 30)

for operator, count in operator_counts.items():

    print(
        f"{operator:10} : {count:,}"
    )


print()

# Technology statistics

technology_counts = {}

for tower in towers:

    technology = tower["technology"]

    technology_counts[technology] = (
        technology_counts.get(
            technology,
            0
        ) + 1
    )


print("TECHNOLOGY")
print("-" * 30)

for technology, count in technology_counts.items():

    print(
        f"{technology:10} : {count:,}"
    )


print()

# Maharashtra statistics

maharashtra_count = sum(

    1
    for tower in towers
    if tower["state"] == "Maharashtra"

)

print(
    f"Maharashtra towers : {maharashtra_count:,}"
)

print()

print(
    f"GeoJSON created : {GEOJSON_FILE}"
)

print(
    f"JSON created    : {JSON_FILE}"
)

print()

print("=" * 60)
print("READY FOR TOWERGIS COVERAGE MAP")
print("=" * 60)