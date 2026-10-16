import "./services/amplifyConfig";
import React from "react";
import ReactDOM from "react-dom/client";
import { Authenticator } from "@aws-amplify/ui-react";
import "./styles/theme.css";
import App from "./App";

// Authenticator.Provider only tracks the Cognito session (no Amplify UI is rendered).
// Sign-up is disabled: accounts are created by an administrator (see amplify/backend.ts).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Authenticator.Provider>
      <App />
    </Authenticator.Provider>
  </React.StrictMode>
);
