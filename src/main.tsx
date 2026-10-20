import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@copilotkit/react-core/v2/styles.css";

createRoot(document.getElementById("root")!).render(
  <App />,
);
