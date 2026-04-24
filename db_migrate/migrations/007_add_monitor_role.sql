-- Document the monitor role for trained monitoring survey volunteers.
-- userrole is a text column; valid values are: 'user', 'monitor', 'admin'.
-- Monitors can create monitoring surveys (vpsurvey); regular users cannot.
COMMENT ON COLUMN vpuser.userrole IS 'User role: user (default), monitor (trained survey volunteer), admin (full access)';
