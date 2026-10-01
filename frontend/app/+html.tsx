// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" style={{ height: "100%", backgroundColor: "#F3F8FF" }}>
      <head>
        <meta charSet="utf-8" />
        <title>Bring Gift Card</title>
        <meta name="application-name" content="Bring Gift Card" />
        <meta name="theme-color" content="#F3F8FF" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        {/*
          Disable body scrolling on web to make ScrollView components work correctly.
          If you want to enable scrolling, remove `ScrollViewStyleReset` and
          set `overflow: auto` on the body style below.
        */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body {
                width: 100%;
                min-height: 100%;
                margin: 0;
                padding: 0;
                background: #F3F8FF;
                overscroll-behavior: none;
              }
              body > div:first-child {
                position: fixed !important;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: #F3F8FF;
              }
              /*
                React Native Web renders TextInput as native input/textarea elements.
                Mobile Safari/Chrome can add a blue focus rectangle around the native
                input or its parent. Bring fields already provide their own visual
                structure, so text entry should stay clean and show only the caret.
              */
              input:focus,
              textarea:focus,
              [contenteditable="true"]:focus {
                outline: none !important;
                outline-width: 0 !important;
                box-shadow: none !important;
              }
              input,
              textarea {
                -webkit-tap-highlight-color: transparent;
              }
              #root :is(button, a, [role="button"], [role="tab"]):focus-visible {
                outline: 2px solid #1F5AF6;
                outline-offset: 2px;
              }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#F3F8FF",
        }}
      >
        {children}
      </body>
    </html>
  );
}
