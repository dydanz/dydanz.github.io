import React from "react";
import ReactDOM from "react-dom";
import {act} from "react-dom/test-utils";
import Projects from "./Projects";
import {StyleProvider} from "../../contexts/StyleContext";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function mockProfile(edges) {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({data: {user: {pinnedItems: {totalCount: edges.length, edges}}}})
    })
  );
}

describe("Projects", () => {
  let container;
  let errorSpy;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    errorSpy.mockRestore();
    delete global.fetch;
  });

  it("does not crash when GitHub returns null pinned repositories", async () => {
    // A repo-scoped GITHUB_TOKEN resolves other repos as `node: null`.
    mockProfile([{node: null}, {node: null}]);

    await act(async () => {
      ReactDOM.render(
        <StyleProvider value={{isDark: false}}>
          <Projects />
        </StyleProvider>,
        container
      );
      await flush();
    });

    const crashed = errorSpy.mock.calls.some(args =>
      String(args[0]).includes("Cannot read properties of null")
    );
    expect(crashed).toBe(false);
  });
});
