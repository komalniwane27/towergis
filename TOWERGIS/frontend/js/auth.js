/* =========================================================
   TOWERGIS AUTHENTICATION SYSTEM
   ========================================================= */

const TOWERGIS_TOKEN_KEY = "towergis_token";
const TOWERGIS_USER_KEY = "towergis_user";


/* =========================================================
   GET TOKEN
   ========================================================= */

function getToken() {

    return localStorage.getItem(
        TOWERGIS_TOKEN_KEY
    );

}


/* =========================================================
   GET STORED USER
   ========================================================= */

function getStoredUser() {

    const user = localStorage.getItem(
        TOWERGIS_USER_KEY
    );

    if (!user) {
        return null;
    }

    try {

        return JSON.parse(user);

    } catch (error) {

        console.error(
            "Invalid stored user data",
            error
        );

        return null;

    }

}


/* =========================================================
   CLEAR SESSION
   ========================================================= */

function logout() {

    localStorage.removeItem(
        TOWERGIS_TOKEN_KEY
    );

    localStorage.removeItem(
        TOWERGIS_USER_KEY
    );

    window.location.href =
        "/app/login.html";

}


/* =========================================================
   GET CURRENT USER FROM BACKEND
   ========================================================= */

async function getCurrentUser() {

    const token = getToken();

    if (!token) {

        return null;

    }


    const response = await fetch(
        "/api/auth/me",
        {
            method: "GET",

            headers: {
                "Authorization":
                    "Bearer " + token
            }
        }
    );


    if (!response.ok) {

        logout();

        return null;

    }


    const user =
        await response.json();


    localStorage.setItem(
        TOWERGIS_USER_KEY,
        JSON.stringify(user)
    );


    return user;

}


/* =========================================================
   REQUIRE ROLE
   ========================================================= */

async function requireRole(requiredRole) {

    const user =
        await getCurrentUser();


    if (!user) {

        return null;

    }


    if (user.role !== requiredRole) {

        console.error(
            `Access denied. Required role: ${requiredRole}. Actual role: ${user.role}`
        );


        alert(
            "You do not have permission to access this page."
        );


        redirectUserByRole(
            user.role
        );


        return null;

    }


    return user;

}


/* =========================================================
   REDIRECT USER BY ROLE
   ========================================================= */

function redirectUserByRole(role) {

    switch (role) {

        case "admin":

            window.location.href =
                "/app/admin/dashboard.html";

            break;


        case "worker":

            window.location.href =
                "/app/worker/dashboard.html";

            break;


        case "customer":

            window.location.href =
                "/app/customer/dashboard.html";

            break;


        default:

            logout();

    }

}