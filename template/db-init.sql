-- Read-only role used by the verifier to inspect data.
CREATE ROLE reader LOGIN PASSWORD 'reader';
GRANT CONNECT ON DATABASE app TO reader;
GRANT USAGE ON SCHEMA public TO reader;
ALTER DEFAULT PRIVILEGES FOR ROLE app IN SCHEMA public GRANT SELECT ON TABLES TO reader;
