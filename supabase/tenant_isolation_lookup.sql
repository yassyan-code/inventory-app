select u.email, u.id as user_id, tm.team_id
from auth.users u
join team_members tm on tm.user_id = u.id
where u.email in ('tenant-a@mailinator.com', 'tenant-b@mailinator.com');
