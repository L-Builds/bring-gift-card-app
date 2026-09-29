-- Keep the existing admin account type while adding a company staff hierarchy.
-- Legacy admins are managers; the first General Manager is created explicitly.
ALTER TABLE users ADD COLUMN staff_role text;
UPDATE users SET staff_role = 'manager' WHERE role = 'admin' AND staff_role IS NULL;
-- Revoke sessions issued before role and password rules were enforced.
UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE role = 'admin';
ALTER TABLE users ADD CONSTRAINT users_staff_role_valid CHECK (
    staff_role IS NULL OR
    (role = 'admin' AND staff_role IN ('general_manager', 'manager', 'worker'))
);
CREATE UNIQUE INDEX users_one_general_manager ON users (staff_role)
    WHERE staff_role = 'general_manager';
