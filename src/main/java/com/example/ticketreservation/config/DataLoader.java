package com.example.ticketreservation.config;

import com.example.ticketreservation.model.AppUser;
import com.example.ticketreservation.model.Event;
import com.example.ticketreservation.model.Role;
import com.example.ticketreservation.repository.EventRepository;
import com.example.ticketreservation.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/** Creates the seeded accounts and sample events on first start. */
@Component
public class DataLoader implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataLoader.class);

    private final UserRepository userRepository;
    private final EventRepository eventRepository;
    private final PasswordEncoder passwordEncoder;

    public DataLoader(UserRepository userRepository, EventRepository eventRepository,
                      PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.eventRepository = eventRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(String... args) {
        if (userRepository.count() == 0) {
            seedUser("admin", "admin123", "System Administrator", Role.ADMIN);
            seedUser("organizer", "organizer123", "Event Organizer", Role.ORGANIZER);
            seedUser("customer", "customer123", "Test Customer", Role.CUSTOMER);
            log.info("Seeded users: admin, organizer, customer");
        }

        if (eventRepository.count() == 0) {
            seedEvent("Colombo Rock Night", "Live rock concert", "Sugathadasa Stadium",
                    LocalDateTime.now().plusMonths(2).withHour(18).withMinute(30).withSecond(0).withNano(0),
                    100, 2500);
            seedEvent("Kelaniya Tech Summit", "One-day technology conference", "University of Kelaniya Auditorium",
                    LocalDateTime.now().plusMonths(3).withHour(9).withMinute(0).withSecond(0).withNano(0),
                    50, 1500);
            seedEvent("Colombo Food Carnival", "Street food from across the island", "Galle Face Green, Colombo",
                    LocalDateTime.now().plusMonths(4).withHour(16).withMinute(0).withSecond(0).withNano(0),
                    200, 500);
            log.info("Seeded sample events");
        }
    }

    private void seedUser(String username, String password, String fullName, Role role) {
        userRepository.save(AppUser.builder()
                .username(username)
                .password(passwordEncoder.encode(password))
                .fullName(fullName)
                .role(role)
                .build());
    }

    private void seedEvent(String name, String description, String venue,
                           LocalDateTime date, int seats, double price) {
        eventRepository.save(Event.builder()
                .name(name)
                .description(description)
                .venue(venue)
                .eventDate(date)
                .totalSeats(seats)
                .availableSeats(seats)
                .ticketPrice(price)
                .organizer("organizer")
                .build());
    }
}
