// JSX declaration for the API-Sports <api-sports-widget> custom element
// (https://widgets.api-sports.io v3). React permits data-* attributes on any
// element, so widget parameters need no extra typing beyond the element itself.

import type { DetailedHTMLProps, HTMLAttributes } from "react";

type ApiSportsWidgetElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "api-sports-widget": ApiSportsWidgetElement;
    }
  }
}
