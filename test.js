const bcrypt = require('bcrypt');

const hashedPassword = '$2y$10$McE1C0kHRDUCkWioFS9nneEy0tMrMkthm60NYz68jJIHAYkXmjLMC'; // Your bcrypt hash
const plaintextPassword = 'rajkumar123'; // Replace with the actual password you are testing

bcrypt.compare(plaintextPassword, hashedPassword, (err, result) => {
  if (err) {
    console.error(err);
  } else if (result) {
    console.log('Password matches!');
  } else {
    console.log('Password does not match.');
  }
});