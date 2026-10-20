export const generatedRepositoryMetadata = (license = "MIT") => ({
  id: 42, name: "example", full_name: "generated/example", html_url: "https://github.com/generated/example",
  owner: { login: "generated", type: "Organization" }, private: false, visibility: "public", license: { spdx_id: license },
  description: "GENERATED_PRIVATE_METADATA_SENTINEL", clone_url: "https://generated-private-credential@github.com/generated/example.git",
});
