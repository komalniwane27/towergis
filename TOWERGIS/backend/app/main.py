from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from pydantic import BaseModel, EmailStr, Field

from pathlib import Path
import sqlite3
import bcrypt
import jwt

from datetime import datetime, timedelta, timezone
from typing import Optional


# ============================================================
# TOWERGIS APPLICATION
# ============================================================

app = FastAPI(
    title="TOWERGIS API",
    version="0.5.0"
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# PATHS
# ============================================================

BASE_DIR = Path(__file__).resolve().parents[2]

frontend_dir = BASE_DIR / "frontend"
database_dir = BASE_DIR / "database"

database_dir.mkdir(exist_ok=True)

DATABASE = database_dir / "towergis.db"


# ============================================================
# JWT CONFIGURATION
# ============================================================

SECRET_KEY = "TOWERGIS-DEVELOPMENT-SECRET-CHANGE-IN-PRODUCTION"

ALGORITHM = "HS256"

TOKEN_EXPIRE_MINUTES = 60

security = HTTPBearer()


# ============================================================
# DATABASE
# ============================================================

def get_db():

    connection = sqlite3.connect(DATABASE)

    connection.row_factory = sqlite3.Row

    connection.execute("PRAGMA foreign_keys = ON")

    return connection


# ============================================================
# CREATE DATABASE TABLES
# ============================================================

def create_tables():

    connection = get_db()

    cursor = connection.cursor()


    # ========================================================
    # USERS
    # ========================================================

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS users (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT NOT NULL,

            email TEXT UNIQUE NOT NULL,

            password_hash TEXT NOT NULL,

            role TEXT NOT NULL DEFAULT 'customer'
                CHECK (
                    role IN (
                        'customer',
                        'worker',
                        'admin'
                    )
                ),

            created_at TEXT NOT NULL

        )
        """
    )


    # ========================================================
    # TELECOM TOWERS
    # ========================================================

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS towers (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            tower_code TEXT UNIQUE NOT NULL,

            name TEXT NOT NULL,

            operator TEXT,

            latitude REAL NOT NULL,

            longitude REAL NOT NULL,

            address TEXT,

            technology TEXT DEFAULT '4G',

            status TEXT NOT NULL DEFAULT 'active'
                CHECK (
                    status IN (
                        'active',
                        'maintenance',
                        'offline'
                    )
                ),

            coverage_radius_km REAL DEFAULT 2.0,

            created_at TEXT NOT NULL

        )
        """
    )


    # ========================================================
    # CUSTOMER COMPLAINTS
    # ========================================================

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS complaints (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER NOT NULL,

            tower_id INTEGER,

            subject TEXT NOT NULL,

            description TEXT NOT NULL,

            priority TEXT NOT NULL DEFAULT 'medium'
                CHECK (
                    priority IN (
                        'low',
                        'medium',
                        'high',
                        'critical'
                    )
                ),

            status TEXT NOT NULL DEFAULT 'open'
                CHECK (
                    status IN (
                        'open',
                        'in_progress',
                        'resolved',
                        'closed'
                    )
                ),

            created_at TEXT NOT NULL,

            updated_at TEXT NOT NULL,

            FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE,

            FOREIGN KEY (tower_id)
                REFERENCES towers(id)
                ON DELETE SET NULL

        )
        """
    )


    # ========================================================
    # SERVICE REQUESTS
    # ========================================================

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS service_requests (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER NOT NULL,

            tower_id INTEGER,

            request_type TEXT NOT NULL,

            description TEXT NOT NULL,

            status TEXT NOT NULL DEFAULT 'submitted'
                CHECK (
                    status IN (
                        'submitted',
                        'assigned',
                        'in_progress',
                        'completed',
                        'cancelled'
                    )
                ),

            created_at TEXT NOT NULL,

            updated_at TEXT NOT NULL,

            FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE,

            FOREIGN KEY (tower_id)
                REFERENCES towers(id)
                ON DELETE SET NULL

        )
        """
    )


    # ========================================================
    # DATABASE INDEXES
    # ========================================================

    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_towers_status
        ON towers(status)
        """
    )

    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_complaints_user
        ON complaints(user_id)
        """
    )

    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_complaints_status
        ON complaints(status)
        """
    )

    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_service_user
        ON service_requests(user_id)
        """
    )

    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_service_status
        ON service_requests(status)
        """
    )


    connection.commit()

    connection.close()


# Create database automatically

create_tables()


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def now_iso():

    return datetime.now(timezone.utc).isoformat()


# ============================================================
# REQUEST MODELS
# ============================================================

class LoginRequest(BaseModel):

    email: EmailStr

    password: str


class RegisterRequest(BaseModel):

    name: str = Field(
        min_length=2,
        max_length=100
    )

    email: EmailStr

    password: str = Field(
        min_length=6,
        max_length=128
    )


class AdminCreateWorker(BaseModel):

    name: str = Field(
        min_length=2,
        max_length=100
    )

    email: EmailStr

    password: str = Field(
        min_length=6,
        max_length=128
    )

class AdminEditWorker(BaseModel):

    name: str = Field(
        min_length=2,
        max_length=100
    )

    email: EmailStr


class ComplaintUpdate(BaseModel):

    status: str


class ComplaintCreate(BaseModel):

    subject: str = Field(
        min_length=3,
        max_length=150
    )

    description: str = Field(
        min_length=5,
        max_length=2000
    )

    tower_id: Optional[int] = None

    priority: str = "medium"


class ServiceRequestCreate(BaseModel):

    request_type: str = Field(
        min_length=2,
        max_length=100
    )

    description: str = Field(
        min_length=5,
        max_length=2000
    )

    tower_id: Optional[int] = None


class TowerCreate(BaseModel):

    tower_code: str = Field(
        min_length=2,
        max_length=50
    )

    name: str = Field(
        min_length=2,
        max_length=150
    )

    operator: Optional[str] = None

    latitude: float

    longitude: float

    address: Optional[str] = None

    technology: str = "4G"

    status: str = "active"

    coverage_radius_km: float = Field(
        default=2.0,
        gt=0
    )


# ============================================================
# PASSWORD HASHING
# ============================================================

def hash_password(password: str) -> str:

    hashed = bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt()
    )

    return hashed.decode("utf-8")


def verify_password(
    password: str,
    password_hash: str
) -> bool:

    return bcrypt.checkpw(
        password.encode("utf-8"),
        password_hash.encode("utf-8")
    )


# ============================================================
# CREATE JWT TOKEN
# ============================================================

def create_access_token(
    user_id: int,
    role: str
):

    expire = (
        datetime.now(timezone.utc)
        + timedelta(
            minutes=TOKEN_EXPIRE_MINUTES
        )
    )

    payload = {

        "sub": str(user_id),

        "role": role,

        "exp": expire

    }

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )


# ============================================================
# GET CURRENT USER
# ============================================================

def get_current_user(
    credentials: HTTPAuthorizationCredentials
    = Depends(security)
):

    token = credentials.credentials

    try:

        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        user_id = payload.get("sub")

        if not user_id:

            raise HTTPException(
                status_code=401,
                detail="Invalid authentication token"
            )


    except jwt.ExpiredSignatureError:

        raise HTTPException(
            status_code=401,
            detail="Token has expired"
        )


    except jwt.InvalidTokenError:

        raise HTTPException(
            status_code=401,
            detail="Invalid authentication token"
        )


    connection = get_db()

    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT
            id,
            name,
            email,
            role,
            created_at

        FROM users

        WHERE id = ?
        """,
        (int(user_id),)
    )

    user = cursor.fetchone()

    connection.close()


    if not user:

        raise HTTPException(
            status_code=401,
            detail="User not found"
        )


    return user


# ============================================================
# ROLE PROTECTION
# ============================================================

def require_customer(
    user=Depends(get_current_user)
):

    if user["role"] != "customer":

        raise HTTPException(
            status_code=403,
            detail="Customer access required"
        )

    return user


def require_worker(
    user=Depends(get_current_user)
):

    if user["role"] != "worker":

        raise HTTPException(
            status_code=403,
            detail="Worker access required"
        )

    return user


def require_admin(
    user=Depends(get_current_user)
):

    if user["role"] != "admin":

        raise HTTPException(
            status_code=403,
            detail="Administrator access required"
        )

    return user


# ============================================================
# STATIC FRONTEND
# ============================================================

app.mount(
    "/app",
    StaticFiles(
        directory=frontend_dir,
        html=True
    ),
    name="frontend"
)


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {

        "message":
            "TOWERGIS API is running",

        "version":
            "0.4.0"

    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/api/health")
def health():

    return {

        "status": "ok",

        "database": "connected"

    }


# ============================================================
# REGISTER
# ============================================================

@app.post("/api/auth/register")
def register(
    request: RegisterRequest
):

    connection = get_db()

    cursor = connection.cursor()


    # --------------------------------------------------------
    # Check existing email
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT id

        FROM users

        WHERE email = ?
        """,
        (request.email,)
    )

    existing_user = cursor.fetchone()


    if existing_user:

        connection.close()

        raise HTTPException(
            status_code=400,
            detail="Email already registered"
        )


    # --------------------------------------------------------
    # Hash password
    # --------------------------------------------------------

    password_hash = hash_password(
        request.password
    )


    # --------------------------------------------------------
    # Public registration creates customer
    # --------------------------------------------------------

    role = "customer"


    # --------------------------------------------------------
    # Insert user
    # --------------------------------------------------------

    cursor.execute(
        """
        INSERT INTO users
        (
            name,
            email,
            password_hash,
            role,
            created_at
        )

        VALUES (?, ?, ?, ?, ?)
        """,
        (
            request.name.strip(),
            request.email,
            password_hash,
            role,
            now_iso()
        )
    )


    user_id = cursor.lastrowid


    connection.commit()

    connection.close()


    return {

        "message":
            "Customer registered successfully",

        "user": {

            "id":
                user_id,

            "name":
                request.name.strip(),

            "email":
                request.email,

            "role":
                role

        }

    }


# ============================================================
# LOGIN
# ============================================================

@app.post("/api/auth/login")
def login(
    request: LoginRequest
):

    connection = get_db()

    cursor = connection.cursor()


    cursor.execute(
        """
        SELECT
            id,
            name,
            email,
            password_hash,
            role

        FROM users

        WHERE email = ?
        """,
        (request.email,)
    )


    user = cursor.fetchone()

    connection.close()


    if not user:

        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )


    # --------------------------------------------------------
    # Verify password
    # --------------------------------------------------------

    if not verify_password(
        request.password,
        user["password_hash"]
    ):

        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )


    # --------------------------------------------------------
    # Generate JWT
    # --------------------------------------------------------

    token = create_access_token(
        user["id"],
        user["role"]
    )


    return {

        "message":
            "Login successful",

        "access_token":
            token,

        "token_type":
            "bearer",

        "user": {

            "id":
                user["id"],

            "name":
                user["name"],

            "email":
                user["email"],

            "role":
                user["role"]

        }

    }


# ============================================================
# CURRENT USER
# ============================================================

@app.get("/api/auth/me")
def get_me(
    user=Depends(get_current_user)
):

    return {

        "id":
            user["id"],

        "name":
            user["name"],

        "email":
            user["email"],

        "role":
            user["role"],

        "created_at":
            user["created_at"]

    }


# ============================================================
# PUBLIC TOWER API
# ============================================================

@app.get("/api/towers")
def get_towers(

    status: Optional[str]
    = Query(default=None),

    limit: int
    = Query(
        default=100,
        ge=1,
        le=500
    )

):

    connection = get_db()

    cursor = connection.cursor()


    if status:

        cursor.execute(
            """
            SELECT
                id,
                tower_code,
                name,
                operator,
                latitude,
                longitude,
                address,
                technology,
                status,
                coverage_radius_km,
                created_at

            FROM towers

            WHERE status = ?

            ORDER BY id DESC

            LIMIT ?
            """,
            (
                status,
                limit
            )
        )

    else:

        cursor.execute(
            """
            SELECT
                id,
                tower_code,
                name,
                operator,
                latitude,
                longitude,
                address,
                technology,
                status,
                coverage_radius_km,
                created_at

            FROM towers

            ORDER BY id DESC

            LIMIT ?
            """,
            (limit,)
        )


    towers = [

        dict(row)

        for row in cursor.fetchall()

    ]


    connection.close()


    return {

        "count":
            len(towers),

        "towers":
            towers

    }


# ============================================================
# CUSTOMER DASHBOARD
# ============================================================

@app.get("/api/customer/dashboard")
def customer_dashboard(
    user=Depends(require_customer)
):

    connection = get_db()

    cursor = connection.cursor()


    # --------------------------------------------------------
    # Active towers
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT COUNT(*) AS count

        FROM towers

        WHERE status = 'active'
        """
    )

    active_towers = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Open complaints
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT COUNT(*) AS count

        FROM complaints

        WHERE user_id = ?

        AND status IN (
            'open',
            'in_progress'
        )
        """,
        (user["id"],)
    )

    open_complaints = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Pending service requests
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT COUNT(*) AS count

        FROM service_requests

        WHERE user_id = ?

        AND status NOT IN (
            'completed',
            'cancelled'
        )
        """,
        (user["id"],)
    )

    service_requests = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Total complaints
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT COUNT(*) AS count

        FROM complaints

        WHERE user_id = ?
        """,
        (user["id"],)
    )

    total_complaints = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Total service requests
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT COUNT(*) AS count

        FROM service_requests

        WHERE user_id = ?
        """,
        (user["id"],)
    )

    total_service_requests = cursor.fetchone()["count"]


    connection.close()


    return {

        "message":
            "Customer dashboard data",

        "user": {

            "id":
                user["id"],

            "name":
                user["name"],

            "email":
                user["email"],

            "role":
                user["role"]

        },

        "stats": {

            "nearby_towers":
                active_towers,

            "network_status":
                (
                    "Good"
                    if active_towers > 0
                    else "Unavailable"
                ),

            "open_complaints":
                open_complaints,

            "service_requests":
                service_requests,

            "total_complaints":
                total_complaints,

            "total_service_requests":
                total_service_requests

        }

    }


# ============================================================
# CUSTOMER PROFILE
# ============================================================

@app.get("/api/customer/profile")
def customer_profile(
    user=Depends(require_customer)
):

    return {

        "id":
            user["id"],

        "name":
            user["name"],

        "email":
            user["email"],

        "role":
            user["role"],

        "created_at":
            user["created_at"]

    }


# ============================================================
# CUSTOMER COMPLAINTS - LIST
# ============================================================

@app.get("/api/customer/complaints")
def get_customer_complaints(
    user=Depends(require_customer)
):

    connection = get_db()

    cursor = connection.cursor()


    cursor.execute(
        """
        SELECT

            c.id,

            c.subject,

            c.description,

            c.priority,

            c.status,

            c.created_at,

            c.updated_at,

            c.tower_id,

            t.tower_code,

            t.name AS tower_name

        FROM complaints c

        LEFT JOIN towers t
            ON t.id = c.tower_id

        WHERE c.user_id = ?

        ORDER BY c.id DESC
        """,
        (user["id"],)
    )


    complaints = [

        dict(row)

        for row in cursor.fetchall()

    ]


    connection.close()


    return {

        "count":
            len(complaints),

        "complaints":
            complaints

    }


# ============================================================
# CUSTOMER COMPLAINTS - CREATE
# ============================================================

@app.post("/api/customer/complaints")
def create_customer_complaint(

    request: ComplaintCreate,

    user=Depends(require_customer)

):

    allowed_priorities = {

        "low",

        "medium",

        "high",

        "critical"

    }


    if request.priority not in allowed_priorities:

        raise HTTPException(

            status_code=400,

            detail=
                "Invalid complaint priority"

        )


    connection = get_db()

    cursor = connection.cursor()


    # --------------------------------------------------------
    # Validate tower
    # --------------------------------------------------------

    if request.tower_id is not None:

        cursor.execute(

            """
            SELECT id

            FROM towers

            WHERE id = ?
            """,

            (request.tower_id,)

        )

        tower = cursor.fetchone()


        if not tower:

            connection.close()

            raise HTTPException(

                status_code=404,

                detail="Tower not found"

            )


    timestamp = now_iso()


    # --------------------------------------------------------
    # Create complaint
    # --------------------------------------------------------

    cursor.execute(

        """
        INSERT INTO complaints
        (
            user_id,
            tower_id,
            subject,
            description,
            priority,
            status,
            created_at,
            updated_at
        )

        VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            'open',
            ?,
            ?
        )
        """,

        (

            user["id"],

            request.tower_id,

            request.subject.strip(),

            request.description.strip(),

            request.priority,

            timestamp,

            timestamp

        )

    )


    complaint_id = cursor.lastrowid


    connection.commit()

    connection.close()


    return {

        "message":
            "Complaint submitted successfully",

        "complaint_id":
            complaint_id,

        "status":
            "open"

    }


# ============================================================
# CUSTOMER SERVICE REQUESTS - LIST
# ============================================================

@app.get("/api/customer/service-requests")
def get_customer_service_requests(

    user=Depends(require_customer)

):

    connection = get_db()

    cursor = connection.cursor()


    cursor.execute(

        """
        SELECT

            s.id,

            s.request_type,

            s.description,

            s.status,

            s.created_at,

            s.updated_at,

            s.tower_id,

            t.tower_code,

            t.name AS tower_name

        FROM service_requests s

        LEFT JOIN towers t
            ON t.id = s.tower_id

        WHERE s.user_id = ?

        ORDER BY s.id DESC
        """,

        (user["id"],)

    )


    requests = [

        dict(row)

        for row in cursor.fetchall()

    ]


    connection.close()


    return {

        "count":
            len(requests),

        "service_requests":
            requests

    }


# ============================================================
# CUSTOMER SERVICE REQUEST - CREATE
# ============================================================

@app.post("/api/customer/service-requests")
def create_service_request(

    request: ServiceRequestCreate,

    user=Depends(require_customer)

):

    connection = get_db()

    cursor = connection.cursor()


    # --------------------------------------------------------
    # Validate tower
    # --------------------------------------------------------

    if request.tower_id is not None:

        cursor.execute(

            """
            SELECT id

            FROM towers

            WHERE id = ?
            """,

            (request.tower_id,)

        )

        tower = cursor.fetchone()


        if not tower:

            connection.close()

            raise HTTPException(

                status_code=404,

                detail="Tower not found"

            )


    timestamp = now_iso()


    # --------------------------------------------------------
    # Create service request
    # --------------------------------------------------------

    cursor.execute(

        """
        INSERT INTO service_requests
        (
            user_id,
            tower_id,
            request_type,
            description,
            status,
            created_at,
            updated_at
        )

        VALUES (
            ?,
            ?,
            ?,
            ?,
            'submitted',
            ?,
            ?
        )
        """,

        (

            user["id"],

            request.tower_id,

            request.request_type.strip(),

            request.description.strip(),

            timestamp,

            timestamp

        )

    )


    request_id = cursor.lastrowid


    connection.commit()

    connection.close()


    return {

        "message":
            "Service request submitted successfully",

        "request_id":
            request_id,

        "status":
            "submitted"

    }

# ============================================================
# ADMIN - LIST USERS
# ============================================================

@app.get("/api/admin/users")
def get_users(
    admin=Depends(require_admin)
):
    connection = get_db()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT id, name, email, role, created_at 
        FROM users 
        WHERE role = 'customer' 
        ORDER BY id DESC
        """
    )

    users = [dict(row) for row in cursor.fetchall()]
    connection.close()

    return {
        "count": len(users),
        "users": users
    }

# ============================================================
# ADMIN - DELETE USER
# ============================================================

@app.delete("/api/admin/users/{user_id}")
def delete_user(
    user_id: int, 
    admin=Depends(require_admin)
):
    connection = get_db()
    cursor = connection.cursor()
    
    cursor.execute("DELETE FROM users WHERE id = ? AND role = 'customer'", (user_id,))
    connection.commit()
    connection.close()
    
    return {"message": "User deleted successfully"}

# ============================================================
# ADMIN - CREATE WORKER
# ============================================================

@app.post("/api/admin/workers")
def create_worker(
    request: AdminCreateWorker,
    admin=Depends(require_admin)
):

    # --------------------------------------------------------
    # Workers must use the official worker email domain
    # --------------------------------------------------------
    email = str(request.email).strip().lower()

    if not email.endswith("@beacon.tc"):
        raise HTTPException(
            status_code=400,
            detail="Worker email must use the @beacon.tc domain."
        )

    connection = get_db()
    cursor = connection.cursor()

    try:
        # ----------------------------------------------------
        # Check existing email
        # ----------------------------------------------------
        cursor.execute(
            "SELECT id FROM users WHERE email = ?",
            (email,)
        )

        existing_user = cursor.fetchone()

        if existing_user:
            raise HTTPException(
                status_code=400,
                detail="Email already registered"
            )

        # ----------------------------------------------------
        # Create worker account
        # ----------------------------------------------------
        password_hash = hash_password(request.password)

        cursor.execute(
            """
            INSERT INTO users
            (
                name,
                email,
                password_hash,
                role,
                created_at
            )
            VALUES (?, ?, ?, 'worker', ?)
            """,
            (
                request.name.strip(),
                email,
                password_hash,
                now_iso()
            )
        )

        worker_id = cursor.lastrowid
        connection.commit()

        return {
            "message": "Worker account created successfully",
            "worker": {
                "id": worker_id,
                "name": request.name.strip(),
                "email": email,
                "role": "worker"
            }
        }

    finally:
        connection.close()


# ============================================================
# ADMIN - LIST WORKERS
# ============================================================

@app.get("/api/admin/workers")
def get_workers(
    admin=Depends(require_admin)
):

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT
            id,
            name,
            email,
            role,
            created_at
        FROM users
        WHERE role = 'worker'
        ORDER BY id DESC
        """
    )

    workers = [dict(row) for row in cursor.fetchall()]
    connection.close()

    return {
        "count": len(workers),
        "workers": workers
    }

# ============================================================
# ADMIN - EDIT WORKER
# ============================================================

@app.put("/api/admin/workers/{worker_id}")
def edit_worker(
    worker_id: int, 
    request: AdminEditWorker, 
    admin=Depends(require_admin)
):
    email = str(request.email).strip().lower()

    if not email.endswith("@beacon.tc"):
        raise HTTPException(
            status_code=400,
            detail="Worker email must use the @beacon.tc domain."
        )

    connection = get_db()
    cursor = connection.cursor()

    # Check if the new email belongs to another account
    cursor.execute("SELECT id FROM users WHERE email = ? AND id != ?", (email, worker_id))
    if cursor.fetchone():
        connection.close()
        raise HTTPException(status_code=400, detail="Email already in use by another account.")

    cursor.execute(
        """
        UPDATE users 
        SET name = ?, email = ? 
        WHERE id = ? AND role = 'worker'
        """,
        (request.name.strip(), email, worker_id)
    )
    
    connection.commit()
    connection.close()
    
    return {"message": "Worker updated successfully"}

# ============================================================
# ADMIN - DELETE WORKER
# ============================================================

@app.delete("/api/admin/workers/{worker_id}")
def delete_worker(
    worker_id: int, 
    admin=Depends(require_admin)
):
    connection = get_db()
    cursor = connection.cursor()
    
    cursor.execute("DELETE FROM users WHERE id = ? AND role = 'worker'", (worker_id,))
    connection.commit()
    connection.close()
    
    return {"message": "Worker deleted successfully"}

# ============================================================
# WORKER + ADMIN - LIST COMPLAINTS
# ============================================================

@app.get("/api/worker/complaints")
def get_worker_complaints(
    worker=Depends(require_worker)
):

    return get_staff_complaints_data()


@app.get("/api/admin/complaints")
def get_admin_complaints(
    admin=Depends(require_admin)
):

    return get_staff_complaints_data()


def get_staff_complaints_data():

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT
            c.id,
            c.subject,
            c.description,
            c.priority,
            c.status,
            c.created_at,
            c.updated_at,
            c.tower_id,
            c.user_id AS customer_id,
            u.name AS customer_name,
            u.email AS customer_email,
            t.tower_code,
            t.name AS tower_name,
            t.address AS tower_address
        FROM complaints c
        JOIN users u
            ON u.id = c.user_id
        LEFT JOIN towers t
            ON t.id = c.tower_id
        ORDER BY
            CASE c.priority
                WHEN 'critical' THEN 1
                WHEN 'high' THEN 2
                WHEN 'medium' THEN 3
                ELSE 4
            END,
            c.id DESC
        """
    )

    complaints = [dict(row) for row in cursor.fetchall()]
    connection.close()

    return {
        "count": len(complaints),
        "complaints": complaints
    }


# ============================================================
# WORKER + ADMIN - UPDATE COMPLAINT STATUS
# ============================================================

@app.put("/api/worker/complaints/{complaint_id}")
def update_worker_complaint(
    complaint_id: int,
    request: ComplaintUpdate,
    worker=Depends(require_worker)
):

    return update_staff_complaint(complaint_id, request)


@app.put("/api/admin/complaints/{complaint_id}")
def update_admin_complaint(
    complaint_id: int,
    request: ComplaintUpdate,
    admin=Depends(require_admin)
):

    return update_staff_complaint(complaint_id, request)


def update_staff_complaint(complaint_id: int, request: ComplaintUpdate):

    allowed_statuses = {
        "open",
        "in_progress",
        "resolved",
        "closed"
    }

    if request.status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid complaint status"
        )

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute(
        "SELECT id FROM complaints WHERE id = ?",
        (complaint_id,)
    )

    complaint = cursor.fetchone()

    if not complaint:
        connection.close()
        raise HTTPException(
            status_code=404,
            detail="Complaint not found"
        )

    cursor.execute(
        """
        UPDATE complaints
        SET
            status = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            request.status,
            now_iso(),
            complaint_id
        )
    )

    connection.commit()
    connection.close()

    return {
        "message": "Complaint updated successfully",
        "complaint_id": complaint_id,
        "status": request.status
    }


# ============================================================
# ADMIN - CREATE TOWER
# ============================================================

@app.post("/api/admin/towers")
def create_tower(

    request: TowerCreate,

    user=Depends(require_admin)

):

    allowed_statuses = {

        "active",

        "maintenance",

        "offline"

    }


    if request.status not in allowed_statuses:

        raise HTTPException(

            status_code=400,

            detail="Invalid tower status"

        )


    # --------------------------------------------------------
    # Validate latitude
    # --------------------------------------------------------

    if not -90 <= request.latitude <= 90:

        raise HTTPException(

            status_code=400,

            detail="Invalid latitude"

        )


    # --------------------------------------------------------
    # Validate longitude
    # --------------------------------------------------------

    if not -180 <= request.longitude <= 180:

        raise HTTPException(

            status_code=400,

            detail="Invalid longitude"

        )


    connection = get_db()

    cursor = connection.cursor()


    # --------------------------------------------------------
    # Check tower code
    # --------------------------------------------------------

    cursor.execute(

        """
        SELECT id

        FROM towers

        WHERE tower_code = ?
        """,

        (request.tower_code,)

    )


    existing_tower = cursor.fetchone()


    if existing_tower:

        connection.close()

        raise HTTPException(

            status_code=400,

            detail="Tower code already exists"

        )


    # --------------------------------------------------------
    # Create tower
    # --------------------------------------------------------

    cursor.execute(

        """
        INSERT INTO towers
        (
            tower_code,
            name,
            operator,
            latitude,
            longitude,
            address,
            technology,
            status,
            coverage_radius_km,
            created_at
        )

        VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
        )
        """,

        (

            request.tower_code.strip(),

            request.name.strip(),

            request.operator,

            request.latitude,

            request.longitude,

            request.address,

            request.technology,

            request.status,

            request.coverage_radius_km,

            now_iso()

        )

    )


    tower_id = cursor.lastrowid


    connection.commit()

    connection.close()


    return {

        "message":
            "Tower created successfully",

        "tower_id":
            tower_id

    }


# ============================================================
# ADMIN DASHBOARD
# ============================================================

@app.get("/api/admin/dashboard")
def admin_dashboard(

    user=Depends(require_admin)

):

    connection = get_db()

    cursor = connection.cursor()


    # --------------------------------------------------------
    # Total users
    # --------------------------------------------------------

    cursor.execute(

        """
        SELECT COUNT(*) AS count

        FROM users
        """

    )

    total_users = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Customers
    # --------------------------------------------------------

    cursor.execute(

        """
        SELECT COUNT(*) AS count

        FROM users

        WHERE role = 'customer'
        """

    )

    customers = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Workers
    # --------------------------------------------------------

    cursor.execute(

        """
        SELECT COUNT(*) AS count

        FROM users

        WHERE role = 'worker'
        """

    )

    workers = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Total towers
    # --------------------------------------------------------

    cursor.execute(

        """
        SELECT COUNT(*) AS count

        FROM towers
        """

    )

    total_towers = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Active towers
    # --------------------------------------------------------

    cursor.execute(

        """
        SELECT COUNT(*) AS count

        FROM towers

        WHERE status = 'active'
        """

    )

    active_towers = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Open complaints
    # --------------------------------------------------------

    cursor.execute(

        """
        SELECT COUNT(*) AS count

        FROM complaints

        WHERE status IN (
            'open',
            'in_progress'
        )
        """

    )

    open_complaints = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Pending service requests
    # --------------------------------------------------------

    cursor.execute(

        """
        SELECT COUNT(*) AS count

        FROM service_requests

        WHERE status NOT IN (
            'completed',
            'cancelled'
        )
        """

    )

    pending_service_requests = cursor.fetchone()["count"]


    connection.close()


    return {

        "message":
            "Admin dashboard data",

        "user": {

            "id":
                user["id"],

            "name":
                user["name"],

            "email":
                user["email"],

            "role":
                user["role"]

        },

        "stats": {

            "total_users":
                total_users,

            "customers":
                customers,

            "workers":
                workers,

            "total_towers":
                total_towers,

            "active_towers":
                active_towers,

            "open_complaints":
                open_complaints,

            "pending_service_requests":
                pending_service_requests

        }

    }


# ============================================================
# WORKER DASHBOARD
# ============================================================

@app.get("/api/worker/dashboard")
def worker_dashboard(

    user=Depends(require_worker)

):

    connection = get_db()

    cursor = connection.cursor()


    # --------------------------------------------------------
    # Open complaints
    # --------------------------------------------------------

    cursor.execute(

        """
        SELECT COUNT(*) AS count

        FROM complaints

        WHERE status IN (
            'open',
            'in_progress'
        )
        """

    )

    open_complaints = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Pending service requests
    # --------------------------------------------------------

    cursor.execute(

        """
        SELECT COUNT(*) AS count

        FROM service_requests

        WHERE status IN (
            'submitted',
            'assigned',
            'in_progress'
        )
        """

    )

    pending_requests = cursor.fetchone()["count"]


    # --------------------------------------------------------
    # Maintenance towers
    # --------------------------------------------------------

    cursor.execute(

        """
        SELECT COUNT(*) AS count

        FROM towers

        WHERE status = 'maintenance'
        """

    )

    maintenance_towers = cursor.fetchone()["count"]


    connection.close()


    return {

        "message":
            "Worker dashboard data",

        "user": {

            "id":
                user["id"],

            "name":
                user["name"],

            "email":
                user["email"],

            "role":
                user["role"]

        },

        "stats": {

            "open_complaints":
                open_complaints,

            "pending_service_requests":
                pending_requests,

            "maintenance_towers":
                maintenance_towers

        }

    }


# ============================================================
# END OF TOWERGIS BACKEND
# ============================================================
# ============================================================
# TOWERGIS COMPLAINT MANAGEMENT EXTENSION
# ============================================================
#
# This section is ADDITIONAL code.
# Do not remove or replace the existing endpoints above.
#
# Adds:
#   1. Complaint notes
#   2. Complaint status history
#   3. Staff complaint management
#   4. Customer complaint details/timeline
#   5. Admin/worker notes
#
# ============================================================


# ============================================================
# ADDITIONAL DATABASE TABLES
# ============================================================

def create_complaint_management_tables():

    connection = get_db()
    cursor = connection.cursor()

    # --------------------------------------------------------
    # COMPLAINT NOTES
    # --------------------------------------------------------

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS complaint_notes (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            complaint_id INTEGER NOT NULL,

            author_id INTEGER NOT NULL,

            note TEXT NOT NULL,

            created_at TEXT NOT NULL,

            FOREIGN KEY (complaint_id)
                REFERENCES complaints(id)
                ON DELETE CASCADE,

            FOREIGN KEY (author_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        )
        """
    )

    # --------------------------------------------------------
    # COMPLAINT STATUS HISTORY
    # --------------------------------------------------------

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS complaint_status_history (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            complaint_id INTEGER NOT NULL,

            changed_by INTEGER NOT NULL,

            old_status TEXT,

            new_status TEXT NOT NULL,

            note TEXT,

            changed_at TEXT NOT NULL,

            FOREIGN KEY (complaint_id)
                REFERENCES complaints(id)
                ON DELETE CASCADE,

            FOREIGN KEY (changed_by)
                REFERENCES users(id)
                ON DELETE CASCADE
        )
        """
    )

    # --------------------------------------------------------
    # INDEXES
    # --------------------------------------------------------

    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS
        idx_complaint_notes_complaint
        ON complaint_notes(complaint_id)
        """
    )

    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS
        idx_complaint_history_complaint
        ON complaint_status_history(complaint_id)
        """
    )

    connection.commit()
    connection.close()


# Create the additional tables automatically

create_complaint_management_tables()


# ============================================================
# REQUEST MODEL FOR STAFF MANAGEMENT
# ============================================================

class ComplaintManageRequest(BaseModel):

    status: Optional[str] = None

    note: Optional[str] = Field(
        default=None,
        max_length=2000
    )


# ============================================================
# REQUEST MODEL FOR ADDING A NOTE
# ============================================================

class ComplaintNoteCreate(BaseModel):

    note: str = Field(
        min_length=2,
        max_length=2000
    )


# ============================================================
# HELPER
# ============================================================

def get_complaint_by_id(complaint_id: int):

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT

            c.id,

            c.user_id,

            c.tower_id,

            c.subject,

            c.description,

            c.priority,

            c.status,

            c.created_at,

            c.updated_at,

            u.name AS customer_name,

            u.email AS customer_email,

            t.tower_code,

            t.name AS tower_name,

            t.address AS tower_address

        FROM complaints c

        JOIN users u
            ON u.id = c.user_id

        LEFT JOIN towers t
            ON t.id = c.tower_id

        WHERE c.id = ?

        """,
        (complaint_id,)
    )

    complaint = cursor.fetchone()

    connection.close()

    return complaint


# ============================================================
# CUSTOMER - COMPLAINT DETAILS
# ============================================================

@app.get("/api/customer/complaints/{complaint_id}")
def customer_complaint_details(

    complaint_id: int,

    user=Depends(require_customer)

):

    connection = get_db()
    cursor = connection.cursor()

    # --------------------------------------------------------
    # Get complaint
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT

            c.id,

            c.user_id,

            c.tower_id,

            c.subject,

            c.description,

            c.priority,

            c.status,

            c.created_at,

            c.updated_at,

            t.tower_code,

            t.name AS tower_name,

            t.address AS tower_address

        FROM complaints c

        LEFT JOIN towers t
            ON t.id = c.tower_id

        WHERE c.id = ?

        AND c.user_id = ?

        """,
        (
            complaint_id,
            user["id"]
        )
    )

    complaint = cursor.fetchone()

    if not complaint:

        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Complaint not found"
        )

    # --------------------------------------------------------
    # Status history
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT

            h.id,

            h.old_status,

            h.new_status,

            h.note,

            h.changed_at,

            u.name AS changed_by_name,

            u.role AS changed_by_role

        FROM complaint_status_history h

        JOIN users u
            ON u.id = h.changed_by

        WHERE h.complaint_id = ?

        ORDER BY h.id ASC

        """,
        (complaint_id,)
    )

    history = [
        dict(row)
        for row in cursor.fetchall()
    ]

    connection.close()

    return {

        "complaint": dict(complaint),

        "history": history

    }


# ============================================================
# STAFF - COMPLAINT DETAILS
# ============================================================

@app.get("/api/worker/complaints/{complaint_id}")
def worker_complaint_details(

    complaint_id: int,

    worker=Depends(require_worker)

):

    return get_staff_complaint_details(
        complaint_id
    )


@app.get("/api/admin/complaints/{complaint_id}")
def admin_complaint_details(

    complaint_id: int,

    admin=Depends(require_admin)

):

    return get_staff_complaint_details(
        complaint_id
    )


def get_staff_complaint_details(
    complaint_id: int
):

    connection = get_db()
    cursor = connection.cursor()

    # --------------------------------------------------------
    # Complaint
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT

            c.id,

            c.user_id AS customer_id,

            c.tower_id,

            c.subject,

            c.description,

            c.priority,

            c.status,

            c.created_at,

            c.updated_at,

            u.name AS customer_name,

            u.email AS customer_email,

            t.tower_code,

            t.name AS tower_name,

            t.address AS tower_address

        FROM complaints c

        JOIN users u
            ON u.id = c.user_id

        LEFT JOIN towers t
            ON t.id = c.tower_id

        WHERE c.id = ?

        """,
        (complaint_id,)
    )

    complaint = cursor.fetchone()

    if not complaint:

        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Complaint not found"
        )

    # --------------------------------------------------------
    # NOTES
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT

            n.id,

            n.note,

            n.created_at,

            u.id AS author_id,

            u.name AS author_name,

            u.email AS author_email,

            u.role AS author_role

        FROM complaint_notes n

        JOIN users u
            ON u.id = n.author_id

        WHERE n.complaint_id = ?

        ORDER BY n.id ASC

        """,
        (complaint_id,)
    )

    notes = [
        dict(row)
        for row in cursor.fetchall()
    ]

    # --------------------------------------------------------
    # STATUS HISTORY
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT

            h.id,

            h.old_status,

            h.new_status,

            h.note,

            h.changed_at,

            u.id AS changed_by_id,

            u.name AS changed_by_name,

            u.role AS changed_by_role

        FROM complaint_status_history h

        JOIN users u
            ON u.id = h.changed_by

        WHERE h.complaint_id = ?

        ORDER BY h.id ASC

        """,
        (complaint_id,)
    )

    history = [
        dict(row)
        for row in cursor.fetchall()
    ]

    connection.close()

    return {

        "complaint": dict(complaint),

        "notes": notes,

        "history": history

    }


# ============================================================
# STAFF - ADD INTERNAL NOTE
# ============================================================

@app.post("/api/worker/complaints/{complaint_id}/notes")
def worker_add_complaint_note(

    complaint_id: int,

    request: ComplaintNoteCreate,

    worker=Depends(require_worker)

):

    return add_staff_complaint_note(
        complaint_id,
        request,
        worker
    )


@app.post("/api/admin/complaints/{complaint_id}/notes")
def admin_add_complaint_note(

    complaint_id: int,

    request: ComplaintNoteCreate,

    admin=Depends(require_admin)

):

    return add_staff_complaint_note(
        complaint_id,
        request,
        admin
    )


def add_staff_complaint_note(

    complaint_id: int,

    request: ComplaintNoteCreate,

    user

):

    connection = get_db()
    cursor = connection.cursor()

    # --------------------------------------------------------
    # Check complaint
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT id
        FROM complaints
        WHERE id = ?
        """,
        (complaint_id,)
    )

    complaint = cursor.fetchone()

    if not complaint:

        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Complaint not found"
        )

    # --------------------------------------------------------
    # Add note
    # --------------------------------------------------------

    timestamp = now_iso()

    cursor.execute(
        """
        INSERT INTO complaint_notes
        (
            complaint_id,
            author_id,
            note,
            created_at
        )

        VALUES (?, ?, ?, ?)
        """,
        (
            complaint_id,
            user["id"],
            request.note.strip(),
            timestamp
        )
    )

    note_id = cursor.lastrowid

    connection.commit()
    connection.close()

    return {

        "message":
            "Complaint note added successfully",

        "note_id":
            note_id,

        "complaint_id":
            complaint_id,

        "author":
            user["name"],

        "role":
            user["role"],

        "created_at":
            timestamp

    }


# ============================================================
# STAFF - MANAGE COMPLAINT
# ============================================================
#
# This endpoint can:
#
#   - change status
#   - add a note
#   - create status history
#
# Example:
#
# {
#     "status": "in_progress",
#     "note": "Worker has started investigating the issue."
# }
#
# ============================================================

@app.put("/api/worker/complaints/{complaint_id}/manage")
def worker_manage_complaint(

    complaint_id: int,

    request: ComplaintManageRequest,

    worker=Depends(require_worker)

):

    return manage_staff_complaint(
        complaint_id,
        request,
        worker
    )


@app.put("/api/admin/complaints/{complaint_id}/manage")
def admin_manage_complaint(

    complaint_id: int,

    request: ComplaintManageRequest,

    admin=Depends(require_admin)

):

    return manage_staff_complaint(
        complaint_id,
        request,
        admin
    )


def manage_staff_complaint(

    complaint_id: int,

    request: ComplaintManageRequest,

    user

):

    allowed_statuses = {

        "open",

        "in_progress",

        "resolved",

        "closed"

    }

    # --------------------------------------------------------
    # Validate request
    # --------------------------------------------------------

    if request.status is None and not request.note:

        raise HTTPException(

            status_code=400,

            detail=
                "Provide a status or note"
        )

    if (

        request.status is not None

        and request.status
        not in allowed_statuses

    ):

        raise HTTPException(

            status_code=400,

            detail="Invalid complaint status"
        )

    connection = get_db()
    cursor = connection.cursor()

    # --------------------------------------------------------
    # Get current complaint
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT

            id,

            status,

            user_id

        FROM complaints

        WHERE id = ?

        """,
        (complaint_id,)
    )

    complaint = cursor.fetchone()

    if not complaint:

        connection.close()

        raise HTTPException(

            status_code=404,

            detail="Complaint not found"
        )

    old_status = complaint["status"]

    new_status = (
        request.status
        if request.status is not None
        else old_status
    )

    timestamp = now_iso()

    # --------------------------------------------------------
    # Update complaint status
    # --------------------------------------------------------

    if request.status is not None:

        cursor.execute(
            """
            UPDATE complaints

            SET

                status = ?,

                updated_at = ?

            WHERE id = ?

            """,
            (
                new_status,

                timestamp,

                complaint_id
            )
        )

    # --------------------------------------------------------
    # Add note
    # --------------------------------------------------------

    if request.note:

        cursor.execute(
            """
            INSERT INTO complaint_notes
            (
                complaint_id,

                author_id,

                note,

                created_at
            )

            VALUES (?, ?, ?, ?)

            """,
            (
                complaint_id,

                user["id"],

                request.note.strip(),

                timestamp
            )
        )

    # --------------------------------------------------------
    # Status changed?
    # --------------------------------------------------------

    status_changed = (
        request.status is not None
        and old_status != new_status
    )

    if status_changed:

        cursor.execute(
            """
            INSERT INTO complaint_status_history
            (
                complaint_id,

                changed_by,

                old_status,

                new_status,

                note,

                changed_at
            )

            VALUES (?, ?, ?, ?, ?, ?)

            """,
            (
                complaint_id,

                user["id"],

                old_status,

                new_status,

                request.note.strip()
                if request.note
                else None,

                timestamp
            )
        )

    connection.commit()
    connection.close()

    return {

        "message":
            "Complaint managed successfully",

        "complaint_id":
            complaint_id,

        "old_status":
            old_status,

        "status":
            new_status,

        "status_changed":
            status_changed,

        "updated_by": {

            "id":
                user["id"],

            "name":
                user["name"],

            "role":
                user["role"]

        },

        "updated_at":
            timestamp

    }


# ============================================================
# CUSTOMER - COMPLAINT STATUS TIMELINE
# ============================================================

@app.get(
    "/api/customer/complaints/{complaint_id}/timeline"
)
def customer_complaint_timeline(

    complaint_id: int,

    user=Depends(require_customer)

):

    connection = get_db()
    cursor = connection.cursor()

    # --------------------------------------------------------
    # Verify ownership
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT

            id,

            subject,

            status

        FROM complaints

        WHERE id = ?

        AND user_id = ?

        """,
        (
            complaint_id,
            user["id"]
        )
    )

    complaint = cursor.fetchone()

    if not complaint:

        connection.close()

        raise HTTPException(

            status_code=404,

            detail="Complaint not found"
        )

    # --------------------------------------------------------
    # Timeline
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT

            h.id,

            h.old_status,

            h.new_status,

            h.note,

            h.changed_at,

            u.name AS changed_by_name,

            u.role AS changed_by_role

        FROM complaint_status_history h

        JOIN users u

            ON u.id = h.changed_by

        WHERE h.complaint_id = ?

        ORDER BY h.id ASC

        """,
        (complaint_id,)
    )

    timeline = [

        dict(row)

        for row in cursor.fetchall()

    ]

    connection.close()

    return {

        "complaint":
            dict(complaint),

        "timeline":
            timeline

    }


# ============================================================
# STAFF - COMPLAINT STATISTICS
# ============================================================

@app.get("/api/admin/complaint-stats")
def admin_complaint_stats(

    admin=Depends(require_admin)

):

    return get_staff_complaint_stats()


@app.get("/api/worker/complaint-stats")
def worker_complaint_stats(

    worker=Depends(require_worker)

):

    return get_staff_complaint_stats()


def get_staff_complaint_stats():

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT

            COUNT(*) AS total,

            SUM(
                CASE
                    WHEN status = 'open'
                    THEN 1
                    ELSE 0
                END
            ) AS open_count,

            SUM(
                CASE
                    WHEN status = 'in_progress'
                    THEN 1
                    ELSE 0
                END
            ) AS in_progress_count,

            SUM(
                CASE
                    WHEN status = 'resolved'
                    THEN 1
                    ELSE 0
                END
            ) AS resolved_count,

            SUM(
                CASE
                    WHEN status = 'closed'
                    THEN 1
                    ELSE 0
                END
            ) AS closed_count,

            SUM(
                CASE
                    WHEN priority = 'critical'
                    THEN 1
                    ELSE 0
                END
            ) AS critical_count,

            SUM(
                CASE
                    WHEN priority = 'high'
                    THEN 1
                    ELSE 0
                END
            ) AS high_count

        FROM complaints
        """
    )

    result = cursor.fetchone()

    connection.close()

    return {

        "total":
            result["total"] or 0,

        "open":
            result["open_count"] or 0,

        "in_progress":
            result["in_progress_count"] or 0,

        "resolved":
            result["resolved_count"] or 0,

        "closed":
            result["closed_count"] or 0,

        "critical":
            result["critical_count"] or 0,

        "high":
            result["high_count"] or 0

    }


# ============================================================
# END OF COMPLAINT MANAGEMENT EXTENSION
# ============================================================