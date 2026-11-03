import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepo } from "../../web/js/io/memory-repo.js";
import { repositoryContract } from "../contracts/repository.contract.js";

repositoryContract({ describe, it, assert, makeRepo: async (opts) => new MemoryRepo(opts) });
