package com.example.ticketreservation.service;

import com.example.ticketreservation.dto.AuthResponse;
import com.example.ticketreservation.dto.LoginRequest;
import com.example.ticketreservation.dto.RegisterRequest;
import com.example.ticketreservation.dto.UserResponse;
import com.example.ticketreservation.dto.UserUpdateRequest;
import com.example.ticketreservation.exception.ApiException;
import com.example.ticketreservation.model.AppUser;
import com.example.ticketreservation.model.ReservationStatus;
import com.example.ticketreservation.model.Role;
import com.example.ticketreservation.repository.ReservationRepository;
import com.example.ticketreservation.repository.UserRepository;
import com.example.ticketreservation.security.JwtService;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final ReservationRepository reservationRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final JwtService jwtService;

    public AuthService(UserRepository userRepository, ReservationRepository reservationRepository,
                       PasswordEncoder passwordEncoder, AuthenticationManager authenticationManager,
                       JwtService jwtService) {
        this.userRepository = userRepository;
        this.reservationRepository = reservationRepository;
        this.passwordEncoder = passwordEncoder;
        this.authenticationManager = authenticationManager;
        this.jwtService = jwtService;
    }

    public AuthResponse login(LoginRequest req) {
        Authentication auth = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(req.username(), req.password()));
        UserDetails details = (UserDetails) auth.getPrincipal();
        AppUser user = userRepository.findByUsername(details.getUsername())
                .orElseThrow(() -> ApiException.notFound("User not found"));
        String token = jwtService.generateToken(details);
        return new AuthResponse(token, "Bearer", jwtService.getExpirationMs(),
                user.getUsername(), user.getFullName(), user.getRole());
    }

    /**
     * Anonymous callers always become CUSTOMER. Only a logged-in ADMIN
     * may create ADMIN or ORGANIZER accounts.
     */
    public UserResponse register(RegisterRequest req) {
        Role requested = req.role() == null ? Role.CUSTOMER : req.role();
        if (requested != Role.CUSTOMER && !currentUserIsAdmin()) {
            throw ApiException.forbidden("Only an ADMIN can create ADMIN or ORGANIZER accounts");
        }
        if (userRepository.existsByUsername(req.username())) {
            throw ApiException.conflict("Username already taken: " + req.username());
        }
        AppUser saved = userRepository.save(AppUser.builder()
                .username(req.username())
                .password(passwordEncoder.encode(req.password()))
                .fullName(req.fullName())
                .role(requested)
                .build());
        return UserResponse.from(saved);
    }

    public UserResponse me(String username) {
        return userRepository.findByUsername(username)
                .map(UserResponse::from)
                .orElseThrow(() -> ApiException.notFound("User not found"));
    }

    public List<UserResponse> listUsers() {
        return userRepository.findAll().stream().map(UserResponse::from).toList();
    }

    /**
     * ADMIN edits a user: only the fields that are sent change.
     * Safety rule: an admin cannot change their own role (they could lock themselves out).
     */
    public UserResponse updateUser(String id, UserUpdateRequest req, String currentUsername) {
        AppUser user = userRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("User not found: " + id));

        if (req.fullName() != null && !req.fullName().isBlank()) {
            user.setFullName(req.fullName().trim());
        }
        if (req.role() != null && req.role() != user.getRole()) {
            if (user.getUsername().equals(currentUsername)) {
                throw ApiException.conflict("You cannot change your own role");
            }
            user.setRole(req.role());
        }
        if (req.password() != null && !req.password().isBlank()) {
            user.setPassword(passwordEncoder.encode(req.password()));
        }
        return UserResponse.from(userRepository.save(user));
    }

    /**
     * ADMIN deletes a user. Safety rules: never yourself, and never a user who still has
     * confirmed reservations (cancel them first).
     */
    public void deleteUser(String id, String currentUsername) {
        AppUser user = userRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("User not found: " + id));

        if (user.getUsername().equals(currentUsername)) {
            throw ApiException.badRequest("You cannot delete your own account");
        }
        if (reservationRepository.existsByCustomerAndStatus(user.getUsername(), ReservationStatus.CONFIRMED)) {
            throw ApiException.conflict("User has confirmed reservations and cannot be deleted");
        }
        userRepository.deleteById(id);
    }

    private boolean currentUserIsAdmin() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.isAuthenticated()
                && auth.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));
    }
}
